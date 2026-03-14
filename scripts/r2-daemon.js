#!/usr/bin/env node
/**
 * Bitcoin Headers R2 Daemon
 *
 * Self-healing daemon that syncs Bitcoin block headers from Electrum servers
 * to a Cloudflare R2 bucket. On startup, figures out what's missing and fills
 * gaps. Then watches for new blocks and keeps R2 current.
 *
 * Environment variables:
 *   R2_ACCOUNT_ID  — Cloudflare account ID
 *   R2_ACCESS_KEY  — R2 API token access key
 *   R2_SECRET_KEY  — R2 API token secret key
 *   R2_BUCKET      — R2 bucket name (default: bitcoin-headers)
 *   R2_PUBLIC_URL  — Public URL prefix (optional, for logging)
 *
 * Usage: node scripts/r2-daemon.js
 */

const tls = require('tls')
const crypto = require('crypto')

// ─── Configuration ───────────────────────────────────────────────────────────

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY
const R2_SECRET_KEY = process.env.R2_SECRET_KEY
const R2_BUCKET = process.env.R2_BUCKET || 'bitcoin-headers'
const R2_CHAIN = process.env.R2_CHAIN || 'btc'
const R2_ENDPOINT = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`

const ELECTRUM_CONFIGS = {
  btc: [
    { host: 'electrum.blockstream.info', port: 50002 },
    { host: 'electrum.jochen-hoenicke.de', port: 50006 },
    { host: 'e-x.not.fyi', port: 50002 },
    { host: 'btc.lastingcoin.net', port: 50002 },
  ],
  tbtc4: [
    { host: 'mempool.space', port: 40002 },
  ],
}
const ELECTRUM_SERVERS = ELECTRUM_CONFIGS[R2_CHAIN] || ELECTRUM_CONFIGS.btc

const HEADER_SIZE = 80
const EPOCH_SIZE = 2016
const KEEPALIVE_INTERVAL = 30000

// ─── R2 Client (wrangler CLI or S3 API) ──────────────────────────────────────

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

const USE_S3_API = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY && R2_SECRET_KEY)

// ── Wrangler-based R2 operations ──

function wranglerPut(key, data) {
  const tmpFile = path.join(os.tmpdir(), 'r2-' + key.replace(/\//g, '-'))
  const dir = path.dirname(tmpFile)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(tmpFile, data)
  const contentType = key.endsWith('.bin') ? 'application/vnd.bitcoin.headers' : 'application/octet-stream'
  const cacheControl = key.startsWith('epoch/') ? 'public, immutable' : 'public, max-age=60'
  try {
    execSync(
      `wrangler r2 object put "${R2_BUCKET}/${key}" --file "${tmpFile}" --content-type "${contentType}" --cache-control "${cacheControl}" --remote`,
      { stdio: 'pipe' }
    )
  } finally {
    try { fs.unlinkSync(tmpFile) } catch {}
  }
}

function wranglerHead(key) {
  try {
    const out = execSync(
      `wrangler r2 object get "${R2_BUCKET}/${key}" --file /dev/null --remote 2>&1`,
      { stdio: 'pipe' }
    ).toString()
    return { exists: true }
  } catch {
    return null
  }
}

function wranglerGet(key) {
  const tmpFile = path.join(os.tmpdir(), 'r2-get-' + key.replace(/\//g, '-'))
  try {
    execSync(
      `wrangler r2 object get "${R2_BUCKET}/${key}" --file "${tmpFile}" --remote`,
      { stdio: 'pipe' }
    )
    const data = fs.readFileSync(tmpFile)
    fs.unlinkSync(tmpFile)
    return data
  } catch {
    return null
  }
}

// ── S3 API-based R2 operations (optional, faster) ──

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest()
}

function sha256hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function getSignatureKey(key, dateStamp, region, service) {
  let k = hmac('AWS4' + key, dateStamp)
  k = hmac(k, region)
  k = hmac(k, service)
  k = hmac(k, 'aws4_request')
  return k
}

async function s3Request(method, key, body) {
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const region = 'auto'
  const service = 's3'

  const host = `${R2_BUCKET}.${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
  const canonicalUri = '/' + key
  const payloadHash = body ? sha256hex(body) : sha256hex('')

  const headers = {
    'host': host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
  }

  const signedHeaders = Object.keys(headers).sort().join(';')
  const canonicalHeaders = Object.keys(headers).sort().map(k => k + ':' + headers[k] + '\n').join('')

  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const credentialScope = dateStamp + '/' + region + '/' + service + '/aws4_request'
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256hex(canonicalRequest)].join('\n')

  const signingKey = getSignatureKey(R2_SECRET_KEY, dateStamp, region, service)
  const signature = hmac(signingKey, stringToSign).toString('hex')

  const authorization = 'AWS4-HMAC-SHA256 Credential=' + R2_ACCESS_KEY + '/' + credentialScope +
    ', SignedHeaders=' + signedHeaders + ', Signature=' + signature

  return fetch('https://' + host + canonicalUri, {
    method,
    headers: { ...headers, authorization },
    body: body || undefined,
  })
}

// ── Unified R2 interface ──

async function r2Put(key, data) {
  if (USE_S3_API) {
    const res = await s3Request('PUT', key, Buffer.from(data))
    if (!res.ok) throw new Error(`R2 PUT ${key} failed: ${res.status}`)
  } else {
    wranglerPut(key, data)
  }
}

async function r2Head(key) {
  if (USE_S3_API) {
    const res = await s3Request('HEAD', key)
    if (res.status === 404) return null
    if (!res.ok) return null
    return { size: parseInt(res.headers.get('content-length') || '0') }
  } else {
    return wranglerHead(key)
  }
}

async function r2Get(key) {
  if (USE_S3_API) {
    const res = await s3Request('GET', key)
    if (res.status === 404) return null
    if (!res.ok) return null
    return Buffer.from(await res.arrayBuffer())
  } else {
    return wranglerGet(key)
  }
}

// ─── Bitcoin Header Utilities ────────────────────────────────────────────────

function hash256(buffer) {
  return crypto.createHash('sha256').update(
    crypto.createHash('sha256').update(buffer).digest()
  ).digest()
}

function getHeaderHash(headerBuf) {
  return Buffer.from(hash256(headerBuf)).reverse().toString('hex')
}

function getPrevHash(headerBuf) {
  return Buffer.from(headerBuf.slice(4, 36)).reverse().toString('hex')
}

function verifyPoW(headerBuf) {
  const hash = Buffer.from(hash256(headerBuf)).reverse()
  const bits = headerBuf.readUInt32LE(72)
  const exponent = bits >> 24
  const mantissa = bits & 0x007fffff
  const target = BigInt(mantissa) * (2n ** BigInt(8 * (exponent - 3)))
  const hashInt = BigInt('0x' + hash.toString('hex'))
  return hashInt <= target
}

// ─── Electrum Client ─────────────────────────────────────────────────────────

class ElectrumClient {
  constructor() {
    this.socket = null
    this.serverIndex = 0
    this.requestId = 0
    this.pendingRequests = new Map()
    this.buffer = ''
    this.connected = false
    this.onHeaderCallback = null
  }

  connect() {
    return new Promise((resolve, reject) => {
      const server = ELECTRUM_SERVERS[this.serverIndex]
      console.log(`  Connecting to ${server.host}:${server.port}...`)

      this.socket = tls.connect({
        host: server.host,
        port: server.port,
        rejectUnauthorized: false,
      })

      this.socket.on('connect', () => {
        this.connected = true
        this.buffer = ''
        resolve()
      })

      this.socket.on('data', (data) => {
        this.buffer += data.toString()
        this.processBuffer()
      })

      this.socket.on('close', () => {
        this.connected = false
      })

      this.socket.on('error', (err) => {
        if (!this.connected) reject(err)
      })

      setTimeout(() => {
        if (!this.connected) {
          this.socket.destroy()
          reject(new Error('Connection timeout'))
        }
      }, 10000)
    })
  }

  processBuffer() {
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop()

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const msg = JSON.parse(line)
        if (msg.method === 'blockchain.headers.subscribe' && this.onHeaderCallback) {
          this.onHeaderCallback(msg.params[0])
          return
        }
        if (msg.id && this.pendingRequests.has(msg.id)) {
          const { resolve, reject, timeout } = this.pendingRequests.get(msg.id)
          clearTimeout(timeout)
          this.pendingRequests.delete(msg.id)
          if (msg.error) reject(new Error(msg.error.message))
          else resolve(msg.result)
        }
      } catch (err) { /* ignore parse errors */ }
    }
  }

  send(method, params = []) {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Timeout: ${method}`))
      }, 30000)
      this.pendingRequests.set(id, { resolve, reject, timeout })
      this.socket.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  }

  async connectWithRetry() {
    for (let attempt = 0; attempt < ELECTRUM_SERVERS.length; attempt++) {
      try {
        await this.connect()
        console.log(`  Connected to ${ELECTRUM_SERVERS[this.serverIndex].host}`)
        return
      } catch (err) {
        console.log(`  Failed: ${err.message}`)
        this.serverIndex = (this.serverIndex + 1) % ELECTRUM_SERVERS.length
      }
    }
    throw new Error('Could not connect to any Electrum server')
  }

  close() {
    if (this.socket) this.socket.destroy()
    this.connected = false
  }
}

// ─── R2 Daemon ───────────────────────────────────────────────────────────────

class R2Daemon {
  constructor() {
    this.electrum = new ElectrumClient()
    this.localHeaders = Buffer.alloc(0) // in-memory header chain
    this.localHeight = -1
  }

  // Figure out what R2 has by downloading all.bin
  async checkR2State() {
    console.log('\n📦 Checking R2 state...')

    // Download all.bin to know current state
    const allBin = await r2Get(R2_CHAIN + '/all.bin')
    let r2Height = -1
    if (allBin) {
      r2Height = Math.floor(allBin.length / HEADER_SIZE) - 1
      console.log(`  all.bin: ${(r2Height + 1).toLocaleString()} headers (tip: ${r2Height.toLocaleString()})`)
      // Use as our starting point
      this.localHeaders = allBin
      this.localHeight = r2Height
    } else {
      console.log('  all.bin: not found (starting from scratch)')
    }

    // Figure out last epoch from height
    const lastEpoch = r2Height > 0 ? Math.floor(r2Height / EPOCH_SIZE) - 1 : -1
    if (lastEpoch >= 0) {
      console.log(`  Epochs: up to ${lastEpoch} expected`)
    }

    return { r2Height, lastEpoch }
  }

  // Sync headers from Electrum into memory
  async syncFromElectrum(fromHeight, toHeight) {
    console.log(`  Syncing ${(toHeight - fromHeight).toLocaleString()} headers from Electrum...`)

    while (this.localHeight < toHeight) {
      const startHeight = this.localHeight + 1
      const count = Math.min(EPOCH_SIZE, toHeight - this.localHeight)

      const result = await this.electrum.send('blockchain.block.headers', [startHeight, count])
      if (!result || !result.hex) throw new Error('Invalid Electrum response')

      const headersBuf = Buffer.from(result.hex, 'hex')
      const headersCount = result.count

      // Verify chain
      let lastHash = null
      if (this.localHeight >= 0) {
        const prevHeader = this.localHeaders.slice(this.localHeight * HEADER_SIZE, (this.localHeight + 1) * HEADER_SIZE)
        lastHash = getHeaderHash(prevHeader)
      }

      for (let i = 0; i < headersCount; i++) {
        const header = headersBuf.slice(i * HEADER_SIZE, (i + 1) * HEADER_SIZE)
        const height = startHeight + i

        if (lastHash) {
          const actualPrevHash = getPrevHash(header)
          if (actualPrevHash !== lastHash) {
            throw new Error(`Chain break at height ${height}`)
          }
        }

        lastHash = getHeaderHash(header)

        // Verify PoW (sample)
        if (height < 1000 || height % 100 === 0) {
          if (!verifyPoW(header)) throw new Error(`PoW failed at height ${height}`)
        }
      }

      // Append to local buffer
      const newBuf = Buffer.alloc(this.localHeaders.length + headersBuf.length)
      this.localHeaders.copy(newBuf)
      headersBuf.copy(newBuf, this.localHeaders.length)
      this.localHeaders = newBuf
      this.localHeight = startHeight + headersCount - 1

      const epoch = Math.floor(this.localHeight / EPOCH_SIZE)
      const pct = ((this.localHeight / toHeight) * 100).toFixed(1)
      process.stdout.write(`  Height ${this.localHeight.toLocaleString()} (epoch ${epoch}) - ${pct}%\r`)
    }
    console.log()
  }

  // Upload missing epochs to R2
  async uploadMissingEpochs(lastR2Epoch) {
    const currentEpoch = Math.floor(this.localHeight / EPOCH_SIZE)
    const lastCompleteEpoch = this.localHeight % EPOCH_SIZE === EPOCH_SIZE - 1
      ? currentEpoch
      : currentEpoch - 1

    let uploaded = 0
    for (let e = lastR2Epoch + 1; e <= lastCompleteEpoch; e++) {
      // Check if already exists
      const existing = await r2Head(`${R2_CHAIN}/epoch/${e}.bin`)
      if (existing && existing.size === EPOCH_SIZE * HEADER_SIZE) continue

      const start = e * EPOCH_SIZE * HEADER_SIZE
      const end = start + EPOCH_SIZE * HEADER_SIZE
      const epochData = this.localHeaders.slice(start, end)

      process.stdout.write(`  Uploading epoch/${e}.bin...`)
      await r2Put(`${R2_CHAIN}/epoch/${e}.bin`, epochData)
      console.log(' done')
      uploaded++
    }

    if (uploaded > 0) console.log(`  Uploaded ${uploaded} epoch files`)
    else console.log('  All epochs up to date')
  }

  // Upload current.bin (current incomplete epoch)
  async uploadCurrent() {
    const currentEpoch = Math.floor(this.localHeight / EPOCH_SIZE)
    const epochStart = currentEpoch * EPOCH_SIZE
    const count = this.localHeight - epochStart + 1

    if (count >= EPOCH_SIZE) return // epoch is complete, handled by uploadMissingEpochs

    const start = epochStart * HEADER_SIZE
    const end = start + count * HEADER_SIZE
    const currentData = this.localHeaders.slice(start, end)

    console.log(`  Uploading current.bin (epoch ${currentEpoch}: ${count} headers)...`)
    await r2Put(R2_CHAIN + '/current.bin', currentData)
    console.log('  Done')
  }

  // Upload all.bin
  async uploadAll() {
    console.log(`  Uploading all.bin (${((this.localHeight + 1) * HEADER_SIZE / 1024 / 1024).toFixed(1)} MB)...`)
    await r2Put(R2_CHAIN + '/all.bin', this.localHeaders.slice(0, (this.localHeight + 1) * HEADER_SIZE))
    console.log('  Done')
  }

  // Handle a new block
  async onNewBlock(height) {
    if (height <= this.localHeight) return

    console.log(`\n⛏  New block: ${height.toLocaleString()}`)

    // Sync from Electrum
    await this.syncFromElectrum(this.localHeight, height)

    // Check if epoch just sealed
    const prevEpoch = Math.floor((height - 1) / EPOCH_SIZE)
    const currEpoch = Math.floor(height / EPOCH_SIZE)
    if (currEpoch > prevEpoch && height % EPOCH_SIZE === 0) {
      console.log(`  *** Epoch ${prevEpoch} sealed ***`)
      await this.uploadMissingEpochs(prevEpoch - 1)
    }

    // Update R2
    await this.uploadCurrent()
    await this.uploadAll()

    console.log(`  R2 updated: tip ${this.localHeight.toLocaleString()}`)
  }

  // Main entry point
  async start() {
    console.log('═══════════════════════════════')
    console.log('  Bitcoin Headers R2 Daemon')
    console.log('═══════════════════════════════')

    console.log(`\nBucket: ${R2_BUCKET}`)
    console.log(`Chain: ${R2_CHAIN}`)
    console.log(`Mode: ${USE_S3_API ? 'S3 API (fast)' : 'wrangler CLI (run wrangler login first)'}`)

    // Check R2 state
    const { r2Height, lastEpoch } = await this.checkR2State()

    // Connect to Electrum
    console.log('\n⚡ Connecting to Electrum...')
    await this.electrum.connectWithRetry()

    // Get chain tip
    const tip = await this.electrum.send('blockchain.headers.subscribe', [])
    console.log(`  Chain tip: ${tip.height.toLocaleString()}`)

    // Sync from Electrum if behind
    if (this.localHeight < tip.height) {
      console.log('\n🔄 Syncing from Electrum...')
      await this.syncFromElectrum(this.localHeight, tip.height)
    }

    // Upload anything missing to R2
    console.log('\n📤 Updating R2...')
    await this.uploadMissingEpochs(lastEpoch)
    await this.uploadCurrent()
    await this.uploadAll()

    console.log('\n✅ Synced and up to date!')
    console.log(`  Local height: ${this.localHeight.toLocaleString()}`)
    console.log(`  R2 bucket: ${R2_BUCKET}`)
    console.log(`  Watching for new blocks...\n`)

    // Watch for new blocks
    this.electrum.onHeaderCallback = async (headerData) => {
      try {
        await this.onNewBlock(headerData.height)
      } catch (err) {
        console.error('Error handling new block:', err.message)
      }
    }

    // Keepalive + check for missed blocks
    setInterval(async () => {
      try {
        await this.electrum.send('server.ping', [])
        const tip = await this.electrum.send('blockchain.headers.subscribe', [])
        if (tip.height > this.localHeight) {
          await this.onNewBlock(tip.height)
        }
      } catch (err) {
        console.error('Keepalive error:', err.message)
        // Reconnect
        try {
          this.electrum.close()
          this.electrum.serverIndex = (this.electrum.serverIndex + 1) % ELECTRUM_SERVERS.length
          await this.electrum.connectWithRetry()
          const tip = await this.electrum.send('blockchain.headers.subscribe', [])
          if (tip.height > this.localHeight) await this.onNewBlock(tip.height)
        } catch (e) {
          console.error('Reconnect failed:', e.message)
        }
      }
    }, KEEPALIVE_INTERVAL)

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('\nShutting down...')
      this.electrum.close()
      process.exit(0)
    })
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

const daemon = new R2Daemon()
daemon.start().catch(err => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
