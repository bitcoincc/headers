#!/usr/bin/env node
/**
 * Bitcoin Headers Daemon
 *
 * Lightweight header-only sync daemon that connects to Electrum servers via TCP/SSL.
 * Fetches all headers and watches for new blocks.
 *
 * Usage: node headers-daemon.js [archive.bin]
 */

const tls = require('tls');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Configuration - TCP/SSL Electrum servers (more reliable than WebSocket)
const ELECTRUM_SERVERS = [
  { host: 'electrum.blockstream.info', port: 50002 },
  { host: 'electrum.jochen-hoenicke.de', port: 50006 },
  { host: 'e-x.not.fyi', port: 50002 },
  { host: 'btc.lastingcoin.net', port: 50002 },
];

const DEFAULT_ARCHIVE = path.join(__dirname, '..', 'headers', 'bitcoin-headers.bin');
const LATEST_JSON = path.join(__dirname, '..', 'headers', 'latest.json');
const CURRENT_JSON = path.join(__dirname, '..', 'headers', 'current.json');
const EPOCH_DIR = path.join(__dirname, '..', 'headers', 'epoch');
const HEADERS_PER_REQUEST = 2016; // One epoch at a time
const RECONNECT_DELAY = 5000;
const EPOCH_SIZE = 2016;
const KEEPALIVE_INTERVAL = 30000; // Ping every 30 seconds

class HeadersDaemon {
  constructor(archivePath) {
    this.archivePath = archivePath;
    this.socket = null;
    this.serverIndex = 0;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.height = -1;
    this.syncing = false;
    this.connected = false;
    this.buffer = '';
    this.keepaliveTimer = null;
  }

  // Get current height from archive file
  getCurrentHeight() {
    try {
      const stat = fs.statSync(this.archivePath);
      if (stat.size % 80 !== 0) {
        console.error('WARNING: Archive size not multiple of 80, file may be corrupt');
      }
      return (stat.size / 80) - 1;
    } catch (err) {
      if (err.code === 'ENOENT') {
        return -1; // File doesn't exist, start from genesis
      }
      throw err;
    }
  }

  // Double SHA256
  hash256(buffer) {
    return crypto.createHash('sha256').update(
      crypto.createHash('sha256').update(buffer).digest()
    ).digest();
  }

  // Verify header meets PoW target
  verifyPoW(headerBuf) {
    const hash = Buffer.from(this.hash256(headerBuf)).reverse();
    const bits = headerBuf.readUInt32LE(72);
    const exponent = bits >> 24;
    const mantissa = bits & 0x007fffff;
    const target = BigInt(mantissa) * (BigInt(2) ** BigInt(8 * (exponent - 3)));
    const hashInt = BigInt('0x' + hash.toString('hex'));
    return hashInt <= target;
  }

  // Get hash of header
  getHeaderHash(headerBuf) {
    return Buffer.from(this.hash256(headerBuf)).reverse().toString('hex');
  }

  // Get previous block hash from header
  getPrevHash(headerBuf) {
    return Buffer.from(headerBuf.slice(4, 36)).reverse().toString('hex');
  }

  // Send JSON-RPC request
  send(method, params = []) {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.destroyed) {
        reject(new Error('Not connected'));
        return;
      }

      const id = ++this.requestId;
      const request = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, 30000);

      this.pendingRequests.set(id, { resolve, reject, method, timeout });
      this.socket.write(JSON.stringify(request) + '\n');
    });
  }

  // Connect to Electrum server via TCP/SSL
  connect() {
    const server = ELECTRUM_SERVERS[this.serverIndex];
    console.log(`Connecting to ${server.host}:${server.port}...`);

    this.socket = tls.connect({
      host: server.host,
      port: server.port,
      rejectUnauthorized: false, // Many Electrum servers use self-signed certs
    });

    this.socket.on('connect', () => {
      console.log('Connected!');
      this.connected = true;
      this.buffer = '';
      this.onConnect();
    });

    this.socket.on('data', (data) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.socket.on('close', () => {
      console.log('Disconnected');
      this.connected = false;
      this.reconnect();
    });

    this.socket.on('error', (err) => {
      console.error('Socket error:', err.message);
    });
  }

  // Process incoming data buffer (newline-delimited JSON)
  processBuffer() {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop(); // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        this.onMessage(msg);
      } catch (err) {
        console.error('Error parsing JSON:', err.message);
      }
    }
  }

  // Reconnect with server rotation
  reconnect() {
    // Stop keepalive
    this.stopKeepalive();

    // Clear pending requests
    for (const [id, req] of this.pendingRequests) {
      clearTimeout(req.timeout);
      req.reject(new Error('Disconnected'));
    }
    this.pendingRequests.clear();

    this.serverIndex = (this.serverIndex + 1) % ELECTRUM_SERVERS.length;
    console.log(`Reconnecting in ${RECONNECT_DELAY / 1000}s...`);
    setTimeout(() => this.connect(), RECONNECT_DELAY);
  }

  // Start keepalive ping timer
  startKeepalive() {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(async () => {
      try {
        await this.send('server.ping', []);
        // Also check if we missed any blocks
        const tip = await this.send('blockchain.headers.subscribe', []);
        if (tip.height > this.height) {
          console.log(`\nMissed block(s), syncing...`);
          await this.sync(tip.height);
          this.updateLatestJson();
          this.updateCurrentEpochJson();
        }
      } catch (err) {
        console.error('Keepalive failed:', err.message);
      }
    }, KEEPALIVE_INTERVAL);
    console.log('Keepalive started (30s interval)');
  }

  // Stop keepalive timer
  stopKeepalive() {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  // Handle incoming messages
  onMessage(msg) {
    // Handle subscription notifications
    if (msg.method === 'blockchain.headers.subscribe') {
      this.onNewHeader(msg.params[0]);
      return;
    }

    // Handle RPC responses
    if (msg.id && this.pendingRequests.has(msg.id)) {
      const { resolve, reject, timeout } = this.pendingRequests.get(msg.id);
      clearTimeout(timeout);
      this.pendingRequests.delete(msg.id);

      if (msg.error) {
        reject(new Error(msg.error.message));
      } else {
        resolve(msg.result);
      }
    }
  }

  // Called when connected
  async onConnect() {
    try {
      // Get current tip and subscribe to new headers
      const tip = await this.send('blockchain.headers.subscribe', []);
      console.log(`Network tip: ${tip.height}`);

      // Load current archive height
      this.height = this.getCurrentHeight();
      console.log(`Local height: ${this.height}`);

      // Sync if behind
      if (this.height < tip.height) {
        await this.sync(tip.height);
      }

      console.log(`\nSynced! Watching for new blocks...`);
      console.log(`Archive: ${this.archivePath}`);
      console.log(`Headers: ${this.height + 1}`);
      console.log(`Size: ${((this.height + 1) * 80 / 1024 / 1024).toFixed(2)} MB\n`);

      // Update latest.json and current epoch JSON after sync
      this.updateLatestJson();
      this.updateCurrentEpochJson();

      // Start keepalive pings
      this.startKeepalive();

    } catch (err) {
      console.error('Error during initial sync:', err.message);
      if (this.socket) this.socket.destroy();
    }
  }

  // Sync headers from current height to tip
  async sync(tipHeight) {
    if (this.syncing) return;
    this.syncing = true;

    console.log(`Syncing ${tipHeight - this.height} headers...`);

    try {
      while (this.height < tipHeight) {
        const startHeight = this.height + 1;
        const count = Math.min(HEADERS_PER_REQUEST, tipHeight - this.height);

        const result = await this.send('blockchain.block.headers', [startHeight, count]);

        if (!result || !result.hex) {
          throw new Error('Invalid response from server');
        }

        const headersBuf = Buffer.from(result.hex, 'hex');
        const headersCount = result.count;

        // Verify and append headers
        try {
          await this.appendHeaders(headersBuf, startHeight, headersCount);
        } catch (err) {
          if (err.message.includes('Chain break')) {
            // Reorg detected during sync - find fork point and restart
            console.log(`  Reorg detected during sync, finding fork point...`);
            this.syncing = false;
            await this.findForkAndResync();
            return;
          }
          throw err;
        }

        const epoch = Math.floor(this.height / 2016);
        const progress = ((this.height / tipHeight) * 100).toFixed(1);
        console.log(`  Height ${this.height} (epoch ${epoch}) - ${progress}%`);
      }
    } finally {
      this.syncing = false;
    }
  }

  // Find fork point with network and resync
  async findForkAndResync() {
    console.log(`  Walking back to find common ancestor...`);

    let forkHeight = this.height;

    while (forkHeight >= 0) {
      const localHeader = this.readHeader(forkHeight);
      const localHash = this.getHeaderHash(localHeader);

      try {
        const result = await this.send('blockchain.block.headers', [forkHeight, 1]);
        if (result && result.hex) {
          const networkHeader = Buffer.from(result.hex, 'hex');
          const networkHash = this.getHeaderHash(networkHeader);

          if (localHash === networkHash) {
            break; // Found common ancestor
          }
        }
      } catch (err) {
        console.error(`  Error fetching header at ${forkHeight}:`, err.message);
      }

      forkHeight--;

      if (this.height - forkHeight > 100) {
        throw new Error(`Reorg too deep (>100 blocks), manual intervention required`);
      }
    }

    const reorgDepth = this.height - forkHeight;
    console.log(`  Fork point: height ${forkHeight} (reorg depth: ${reorgDepth})`);

    // Truncate and resync
    const newSize = (forkHeight + 1) * 80;
    fs.truncateSync(this.archivePath, newSize);
    this.height = forkHeight;
    console.log(`  Truncated archive to height ${forkHeight}`);

    const tip = await this.send('blockchain.headers.subscribe', []);
    await this.sync(tip.height);
  }

  // Append headers to archive with verification
  async appendHeaders(headersBuf, startHeight, count) {
    // Get last header hash for chain verification (if not genesis)
    let expectedPrevHash = null;
    if (startHeight > 0) {
      const lastHeader = this.readHeader(startHeight - 1);
      if (lastHeader) {
        expectedPrevHash = this.getHeaderHash(lastHeader);
      }
    }

    // Verify each header
    for (let i = 0; i < count; i++) {
      const header = headersBuf.slice(i * 80, (i + 1) * 80);
      const height = startHeight + i;

      // Verify chain link
      if (expectedPrevHash) {
        const prevHash = this.getPrevHash(header);
        if (prevHash !== expectedPrevHash) {
          throw new Error(`Chain break at height ${height}: expected prev ${expectedPrevHash}, got ${prevHash}`);
        }
      }

      // Verify PoW (sample every 100 blocks for speed)
      if (height % 100 === 0 || height < 1000) {
        if (!this.verifyPoW(header)) {
          throw new Error(`PoW verification failed at height ${height}`);
        }
      }

      expectedPrevHash = this.getHeaderHash(header);
    }

    // All verified, append to file
    fs.appendFileSync(this.archivePath, headersBuf);
    this.height = startHeight + count - 1;
  }

  // Read a specific header from archive
  readHeader(height) {
    const fd = fs.openSync(this.archivePath, 'r');
    const buf = Buffer.alloc(80);
    fs.readSync(fd, buf, 0, 80, height * 80);
    fs.closeSync(fd);
    return buf;
  }

  // Update latest.json with current stats
  updateLatestJson() {
    try {
      const stat = fs.statSync(this.archivePath);
      const tipHeight = this.height;
      const tipHeader = this.readHeader(tipHeight);
      const tipHash = this.getHeaderHash(tipHeader);
      const tipTime = tipHeader.readUInt32LE(68);

      const currentEpochNumber = Math.floor(tipHeight / EPOCH_SIZE);
      const currentEpochStart = currentEpochNumber * EPOCH_SIZE;
      const headersInCurrentEpoch = tipHeight - currentEpochStart + 1;
      const isEpochComplete = headersInCurrentEpoch === EPOCH_SIZE;

      const archivedEpochs = isEpochComplete ? currentEpochNumber + 1 : currentEpochNumber;
      const archivedBlocks = archivedEpochs * EPOCH_SIZE - 1;

      const latest = {
        tip: {
          height: tipHeight,
          hash: tipHash,
          time: tipTime
        },
        current_epoch: {
          epoch: currentEpochNumber,
          start_height: currentEpochStart,
          count: headersInCurrentEpoch,
          complete: isEpochComplete
        },
        archived_epochs: {
          count: archivedEpochs,
          last: archivedEpochs - 1,
          blocks: archivedBlocks
        },
        chain_size: stat.size,
        updated: new Date().toISOString()
      };

      fs.writeFileSync(LATEST_JSON, JSON.stringify(latest, null, 2));
      console.log(`  Updated latest.json (height: ${tipHeight})`);
    } catch (err) {
      console.error('Error updating latest.json:', err.message);
    }
  }

  // Parse header buffer to JSON object
  headerToJson(headerBuf, height) {
    return {
      height,
      version: headerBuf.readUInt32LE(0),
      prev_block: Buffer.from(headerBuf.slice(4, 36)).reverse().toString('hex'),
      merkle_root: Buffer.from(headerBuf.slice(36, 68)).reverse().toString('hex'),
      timestamp: headerBuf.readUInt32LE(68),
      bits: headerBuf.readUInt32LE(72).toString(16).padStart(8, '0'),
      nonce: headerBuf.readUInt32LE(76),
      hash: this.getHeaderHash(headerBuf)
    };
  }

  // Update current epoch JSON file
  updateCurrentEpochJson() {
    try {
      const currentEpochNumber = Math.floor(this.height / EPOCH_SIZE);
      const epochStart = currentEpochNumber * EPOCH_SIZE;
      const epochFile = path.join(EPOCH_DIR, `${currentEpochNumber}.json`);

      // Read all headers for current epoch from archive
      const headers = [];
      for (let h = epochStart; h <= this.height; h++) {
        const headerBuf = this.readHeader(h);
        headers.push(this.headerToJson(headerBuf, h));
      }

      const epochData = {
        epoch: currentEpochNumber,
        start_height: epochStart,
        end_height: this.height,
        start_time: headers[0].timestamp,
        end_time: headers[headers.length - 1].timestamp,
        count: headers.length,
        headers
      };

      fs.writeFileSync(epochFile, JSON.stringify(epochData));

      // Also update current.json (used by website for current epoch)
      fs.writeFileSync(CURRENT_JSON, JSON.stringify(epochData));

      console.log(`  Updated epoch ${currentEpochNumber}.json + current.json (${headers.length} headers)`);
    } catch (err) {
      console.error('Error updating epoch JSON:', err.message);
    }
  }

  // Handle chain reorganization
  async handleReorg(newHeaderData) {
    const newHeaderBuf = Buffer.from(newHeaderData.hex, 'hex');
    const newPrevHash = this.getPrevHash(newHeaderBuf);
    const newHeight = newHeaderData.height;

    console.log(`  Detecting reorg depth...`);

    // Find fork point by walking back through our chain
    let forkHeight = this.height;
    let found = false;

    while (forkHeight >= 0) {
      const localHeader = this.readHeader(forkHeight);
      const localHash = this.getHeaderHash(localHeader);

      // Check if this is the prev_hash the new block points to
      if (localHash === newPrevHash) {
        // The new block builds on this height
        found = true;
        break;
      }

      // Also fetch what the network has at this height to find common ancestor
      try {
        const result = await this.send('blockchain.block.headers', [forkHeight, 1]);
        if (result && result.hex) {
          const networkHeader = Buffer.from(result.hex, 'hex');
          const networkHash = this.getHeaderHash(networkHeader);

          if (localHash === networkHash) {
            // Found common ancestor
            found = true;
            break;
          }
        }
      } catch (err) {
        console.error(`  Error fetching header at ${forkHeight}:`, err.message);
      }

      forkHeight--;

      // Safety limit - don't reorg more than 100 blocks
      if (this.height - forkHeight > 100) {
        throw new Error(`Reorg too deep (>100 blocks), manual intervention required`);
      }
    }

    if (!found) {
      throw new Error(`Could not find fork point, manual intervention required`);
    }

    const reorgDepth = this.height - forkHeight;
    console.log(`  Reorg detected! Depth: ${reorgDepth} block(s)`);
    console.log(`  Fork point: height ${forkHeight}`);

    // Truncate archive to fork point
    const newSize = (forkHeight + 1) * 80;
    fs.truncateSync(this.archivePath, newSize);
    this.height = forkHeight;
    console.log(`  Truncated archive to height ${forkHeight}`);

    // Re-sync from fork point
    const tip = await this.send('blockchain.headers.subscribe', []);
    console.log(`  Re-syncing to height ${tip.height}...`);
    await this.sync(tip.height);

    // Update JSON files
    this.updateLatestJson();
    this.updateCurrentEpochJson();

    console.log(`  Reorg complete. New height: ${this.height}`);
  }

  // Handle new header notification
  async onNewHeader(headerData) {
    const height = headerData.height;

    if (height <= this.height) {
      return; // Already have this header
    }

    console.log(`\nNew block: ${height}`);

    // If we're missing blocks, do a full sync
    if (height > this.height + 1) {
      console.log(`Missing blocks, syncing...`);
      await this.sync(height);
      this.updateLatestJson();
      this.updateCurrentEpochJson();
      return;
    }

    // Check for potential reorg before appending
    const headerBuf = Buffer.from(headerData.hex, 'hex');
    const prevHash = this.getPrevHash(headerBuf);
    const lastHeader = this.readHeader(this.height);
    const expectedPrevHash = this.getHeaderHash(lastHeader);

    if (prevHash !== expectedPrevHash) {
      console.log(`  Chain break detected - handling reorg...`);
      await this.handleReorg(headerData);
      return;
    }

    // Normal case - append single header
    await this.appendHeaders(headerBuf, height, 1);

    const hash = this.getHeaderHash(headerBuf);
    console.log(`  Hash: ${hash.slice(0, 16)}...`);
    console.log(`  Height: ${this.height}`);

    // Update latest.json and current epoch JSON
    this.updateLatestJson();
    this.updateCurrentEpochJson();

    // Check for epoch completion
    if ((this.height + 1) % 2016 === 0) {
      const epoch = Math.floor(this.height / 2016);
      console.log(`\n*** Epoch ${epoch} complete! ***\n`);
    }
  }

  // Start the daemon
  start() {
    console.log('=================================');
    console.log('  Bitcoin Headers Daemon');
    console.log('=================================\n');
    console.log(`Archive: ${this.archivePath}`);

    this.connect();

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\nShutting down...');
      if (this.socket) {
        this.socket.destroy();
      }
      process.exit(0);
    });
  }
}

// Main
const archivePath = process.argv[2] || DEFAULT_ARCHIVE;
const daemon = new HeadersDaemon(archivePath);
daemon.start();
