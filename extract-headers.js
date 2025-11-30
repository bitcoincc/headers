#!/usr/bin/env node

const { Level } = require('level')
const fs = require('fs')
const path = require('path')

const BITCOIN_DIR = process.env.BITCOIN_DIR || '/media/melvin/41/.bitcoin'
const OUTPUT_DIR = process.env.OUTPUT_DIR || './headers/epoch'
const INDEX_PATH = path.join(BITCOIN_DIR, 'blocks', 'index')

// Bitcoin Core CVarInt decoder (different from CompactSize)
function readCVarInt(buffer, offset) {
  let n = 0
  let pos = offset
  while (true) {
    const ch = buffer[pos++]
    n = (n << 7) | (ch & 0x7F)
    if ((ch & 0x80) === 0) {
      return { value: n, size: pos - offset }
    }
    n++
  }
}

// Parse block index value from LevelDB
function parseBlockIndex(value) {
  let offset = 0

  // Client version (CVarInt)
  const clientVersion = readCVarInt(value, offset)
  offset += clientVersion.size

  // Height (CVarInt)
  const height = readCVarInt(value, offset)
  offset += height.size

  // Status (CVarInt)
  const status = readCVarInt(value, offset)
  offset += status.size

  // nTx (CVarInt)
  const nTx = readCVarInt(value, offset)
  offset += nTx.size

  // nFile (CVarInt) - if BLOCK_HAVE_DATA (status & 8)
  if (status.value & 8) {
    const nFile = readCVarInt(value, offset)
    offset += nFile.size
  }

  // nDataPos (CVarInt) - if BLOCK_HAVE_DATA
  if (status.value & 8) {
    const nDataPos = readCVarInt(value, offset)
    offset += nDataPos.size
  }

  // nUndoPos (CVarInt) - if BLOCK_HAVE_UNDO (status & 16)
  if (status.value & 16) {
    const nUndoPos = readCVarInt(value, offset)
    offset += nUndoPos.size
  }

  // Now the header data (80 bytes)
  const version = value.readInt32LE(offset)
  offset += 4

  const prevBlock = value.slice(offset, offset + 32).reverse().toString('hex')
  offset += 32

  const merkleRoot = value.slice(offset, offset + 32).reverse().toString('hex')
  offset += 32

  const timestamp = value.readUInt32LE(offset)
  offset += 4

  const bits = value.readUInt32LE(offset).toString(16).padStart(8, '0')
  offset += 4

  const nonce = value.readUInt32LE(offset)

  return {
    height: height.value,
    version,
    prev_block: prevBlock,
    merkle_root: merkleRoot,
    timestamp,
    bits,
    nonce
  }
}

async function main() {
  console.log('Opening LevelDB at:', INDEX_PATH)

  const db = new Level(INDEX_PATH, {
    keyEncoding: 'binary',
    valueEncoding: 'binary',
    createIfMissing: false
  })

  await db.open()
  console.log('Database opened')

  const headers = new Map()
  let count = 0
  let maxHeight = 0

  // Iterate all block index entries (key prefix 'b')
  for await (const [key, value] of db.iterator()) {
    if (key[0] === 0x62) { // 'b' = 0x62
      try {
        const blockHash = Buffer.from(key.slice(1)).reverse().toString('hex')
        const header = parseBlockIndex(Buffer.from(value))
        header.hash = blockHash

        // Only keep if valid height and better than existing
        if (header.height >= 0 && header.height < 10000000) {
          if (!headers.has(header.height) || headers.get(header.height).timestamp < header.timestamp) {
            headers.set(header.height, header)
            if (header.height > maxHeight) maxHeight = header.height
          }
        }

        count++
        if (count % 100000 === 0) {
          console.log(`Processed ${count} entries, unique heights: ${headers.size}, max: ${maxHeight}`)
        }
      } catch (e) {
        // Skip malformed entries
      }
    }
  }

  await db.close()
  console.log(`Total entries: ${count}, unique headers: ${headers.size}, max height: ${maxHeight}`)

  // Sort by height
  const sorted = Array.from(headers.values()).sort((a, b) => a.height - b.height)

  // Verify chain continuity
  console.log(`First header height: ${sorted[0]?.height}, last: ${sorted[sorted.length - 1]?.height}`)

  const numEpochs = Math.floor(maxHeight / 2016) + 1
  console.log(`Epochs to write: ${numEpochs}`)

  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  // Write epochs
  for (let epoch = 0; epoch < numEpochs; epoch++) {
    const startHeight = epoch * 2016
    const endHeight = Math.min((epoch + 1) * 2016 - 1, maxHeight)

    const epochHeaders = sorted.filter(h => h.height >= startHeight && h.height <= endHeight)

    if (epochHeaders.length === 0) continue

    const epochData = {
      epoch,
      start_height: startHeight,
      end_height: endHeight,
      start_time: epochHeaders[0].timestamp,
      end_time: epochHeaders[epochHeaders.length - 1].timestamp,
      count: epochHeaders.length,
      headers: epochHeaders
    }

    const filename = path.join(OUTPUT_DIR, `${epoch}.json`)
    fs.writeFileSync(filename, JSON.stringify(epochData))

    if (epoch % 50 === 0 || epoch === numEpochs - 1) {
      console.log(`Wrote epoch ${epoch} (${epochHeaders.length} headers)`)
    }
  }

  // Write latest.json
  const latestEpoch = Math.floor(maxHeight / 2016)
  const tip = sorted[sorted.length - 1]

  const latest = {
    current_epoch: latestEpoch,
    tip_height: tip.height,
    tip_hash: tip.hash,
    tip_time: tip.timestamp,
    updated: new Date().toISOString()
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, '..', 'latest.json'), JSON.stringify(latest, null, 2))
  console.log('Wrote latest.json')

  console.log('Done!')
}

main().catch(console.error)
