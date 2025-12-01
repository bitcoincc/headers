#!/usr/bin/env node
/**
 * Bitcoin Headers Nostr Publisher
 *
 * Watches for new blocks and publishes headers to Nostr relays.
 * Uses kind 21021 per NIP-XX (Bitcoin Block Headers).
 *
 * Usage:
 *   node nostr-publisher.js [--key <hex-privkey>] [--headers <count>]
 *
 * Environment:
 *   NOSTR_PRIVKEY - hex-encoded private key (or generates ephemeral)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
const { finalizeEvent, generateSecretKey, getPublicKey } = require('nostr-tools');

// Config
const HEADERS_DIR = path.join(__dirname, '..', 'headers');
const ARCHIVE_PATH = path.join(HEADERS_DIR, 'bitcoin-headers.bin');
const LATEST_JSON = path.join(HEADERS_DIR, 'latest.json');
const DEFAULT_HEADER_COUNT = 12;  // ~2 hours of blocks, good for confirmations
const KIND_BITCOIN_HEADERS = 31021;  // Parameterized replaceable (30000+)

const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://relay.nostr.net',
  'wss://relay.primal.net',
];

class NostrPublisher {
  constructor(options = {}) {
    this.headerCount = options.headerCount || DEFAULT_HEADER_COUNT;
    this.sockets = new Map();
    this.lastPublishedHeight = -1;

    // Setup keys
    if (options.privateKey) {
      this.secretKey = Buffer.from(options.privateKey, 'hex');
    } else {
      this.secretKey = generateSecretKey();
      console.log('Generated ephemeral key (use --key to persist):');
      console.log('  Private:', Buffer.from(this.secretKey).toString('hex'));
    }
    this.publicKey = getPublicKey(this.secretKey);

    console.log('Public key:', this.publicKey);
    console.log('Header count:', this.headerCount);
  }

  // Read multiple headers from archive
  readHeaders(startHeight, count) {
    const fd = fs.openSync(ARCHIVE_PATH, 'r');
    const buf = Buffer.alloc(80 * count);
    fs.readSync(fd, buf, 0, 80 * count, startHeight * 80);
    fs.closeSync(fd);
    return buf;
  }

  // Get current tip from latest.json
  getCurrentTip() {
    try {
      const data = JSON.parse(fs.readFileSync(LATEST_JSON, 'utf8'));
      return data.tip.height;
    } catch (err) {
      console.error('Error reading latest.json:', err.message);
      return -1;
    }
  }

  // Create and sign headers event
  createHeadersEvent(tipHeight) {
    const count = Math.min(this.headerCount, tipHeight + 1);
    const startHeight = tipHeight - count + 1;

    const headers = this.readHeaders(startHeight, count);

    const eventTemplate = {
      kind: KIND_BITCOIN_HEADERS,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', 'latest'],
        ['n', 'mainnet'],
        ['tip', tipHeight.toString()],
        ['start', startHeight.toString()],
        ['count', count.toString()]
      ],
      content: headers.toString('hex')
    };

    return finalizeEvent(eventTemplate, this.secretKey);
  }

  // Connect to relay
  connectRelay(url) {
    if (this.sockets.has(url)) return;

    console.log(`Connecting to ${url}...`);

    const ws = new WebSocket(url);

    ws.on('open', () => {
      console.log(`Connected to ${url}`);
      this.sockets.set(url, ws);
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg[0] === 'OK') {
          const status = msg[2] ? 'OK' : 'REJECTED';
          if (!msg[2]) {
            console.log(`  ${url}: ${status} - ${msg[3] || 'unknown reason'}`);
          }
        } else if (msg[0] === 'NOTICE') {
          console.log(`  ${url} notice: ${msg[1]}`);
        }
      } catch (err) {
        // Ignore parse errors
      }
    });

    ws.on('close', () => {
      console.log(`Disconnected from ${url}`);
      this.sockets.delete(url);
      // Reconnect after delay
      setTimeout(() => this.connectRelay(url), 10000);
    });

    ws.on('error', (err) => {
      // Only log if not a connection refused (relay down)
      if (err.code !== 'ECONNREFUSED') {
        console.error(`${url} error:`, err.message);
      }
    });
  }

  // Publish event to all connected relays
  publish(event) {
    const msg = JSON.stringify(['EVENT', event]);
    let published = 0;

    for (const [url, ws] of this.sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
        published++;
      }
    }

    return published;
  }

  // Check for new block and publish
  checkAndPublish() {
    const tipHeight = this.getCurrentTip();

    if (tipHeight <= this.lastPublishedHeight) {
      return false;
    }

    console.log(`\nNew block: ${tipHeight}`);

    try {
      const event = this.createHeadersEvent(tipHeight);
      const relayCount = this.publish(event);

      const start = event.tags.find(t => t[0] === 'start')[1];
      const headerCount = event.tags.find(t => t[0] === 'count')[1];
      console.log(`  Published to ${relayCount} relays`);
      console.log(`  Event: ${event.id.slice(0, 16)}...`);
      console.log(`  Range: ${start}-${tipHeight} (${headerCount} headers)`);

      this.lastPublishedHeight = tipHeight;
      return true;
    } catch (err) {
      console.error('Error publishing:', err.message);
      return false;
    }
  }

  // Start watching and publishing
  start() {
    console.log('\n=================================');
    console.log('  Bitcoin Headers Nostr Publisher');
    console.log('=================================\n');

    // Connect to relays
    for (const url of RELAYS) {
      this.connectRelay(url);
    }

    // Wait for connections then publish current state
    setTimeout(() => {
      this.checkAndPublish();
    }, 3000);

    // Watch latest.json for changes
    console.log(`Watching ${LATEST_JSON}...`);

    let watchDebounce = null;
    fs.watch(LATEST_JSON, (eventType) => {
      if (eventType === 'change') {
        // Debounce rapid changes
        if (watchDebounce) clearTimeout(watchDebounce);
        watchDebounce = setTimeout(() => this.checkAndPublish(), 1000);
      }
    });

    // Also poll periodically as backup
    setInterval(() => this.checkAndPublish(), 60000);

    // Handle shutdown
    process.on('SIGINT', () => {
      console.log('\nShutting down...');
      for (const ws of this.sockets.values()) {
        ws.close();
      }
      process.exit(0);
    });
  }
}

// Parse CLI args
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--key' && args[i + 1]) {
      options.privateKey = args[++i];
    } else if (args[i] === '--headers' && args[i + 1]) {
      options.headerCount = parseInt(args[++i], 10);
    } else if (args[i] === '--help') {
      console.log('Usage: node nostr-publisher.js [options]');
      console.log('');
      console.log('Options:');
      console.log('  --key <hex>      Private key (64 hex chars, generates ephemeral if not set)');
      console.log('  --headers <n>    Number of headers to publish (default: 10)');
      console.log('');
      console.log('Environment:');
      console.log('  NOSTR_PRIVKEY    Alternative to --key');
      process.exit(0);
    }
  }

  // Check env
  if (!options.privateKey && process.env.NOSTR_PRIVKEY) {
    options.privateKey = process.env.NOSTR_PRIVKEY;
  }

  return options;
}

// Main
const options = parseArgs();
const publisher = new NostrPublisher(options);
publisher.start();
