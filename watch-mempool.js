#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const API_BASE = process.env.API_BASE || 'https://mempool.space/api'
const OUTPUT_DIR = process.env.OUTPUT_DIR || './headers'
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL) || 60000 // 60 seconds (be nice to public API)

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const fetchJson = async (url) => {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (e) {
    console.error(`Fetch error (${url}): ${e.message}`)
    return null
  }
}

const fetchText = async (url) => {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } catch (e) {
    console.error(`Fetch error (${url}): ${e.message}`)
    return null
  }
}

const getBlockTip = async () => {
  const height = await fetchText(`${API_BASE}/blocks/tip/height`)
  return height ? parseInt(height) : null
}

const getBlockHash = async (height) => {
  return await fetchText(`${API_BASE}/block-height/${height}`)
}

const getBlock = async (hash) => {
  return await fetchJson(`${API_BASE}/block/${hash}`)
}

const loadLatest = () => {
  const file = path.join(OUTPUT_DIR, 'latest.json')
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  }
  return null
}

const saveLatest = (data) => {
  const file = path.join(OUTPUT_DIR, 'latest.json')
  data.updated = new Date().toISOString()
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

const loadCurrent = () => {
  const file = path.join(OUTPUT_DIR, 'current.json')
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  }
  return null
}

const saveCurrent = (data) => {
  const file = path.join(OUTPUT_DIR, 'current.json')
  fs.writeFileSync(file, JSON.stringify(data))
}

const archiveEpoch = (epochData) => {
  const epochDir = path.join(OUTPUT_DIR, 'epoch')
  if (!fs.existsSync(epochDir)) fs.mkdirSync(epochDir, { recursive: true })
  const file = path.join(epochDir, `${epochData.epoch}.json`)
  fs.writeFileSync(file, JSON.stringify(epochData))
  console.log(`Archived epoch ${epochData.epoch}`)
}

const headerFromApi = (block) => ({
  height: block.height,
  version: block.version,
  prev_block: block.previousblockhash || '0'.repeat(64),
  merkle_root: block.merkle_root,
  timestamp: block.timestamp,
  bits: block.bits.toString(16).padStart(8, '0'),
  nonce: block.nonce,
  hash: block.id
})

const checkForNewBlocks = async () => {
  const tipHeight = await getBlockTip()
  if (tipHeight === null) {
    console.log('Could not get tip height from mempool.space')
    return
  }

  let latest = loadLatest()
  let current = loadCurrent()

  if (!latest || !current) {
    console.log('Missing latest.json or current.json, run extraction first')
    return
  }

  const ourTip = latest.tip.height

  if (tipHeight <= ourTip) {
    console.log(`No new blocks (mempool.space: ${tipHeight}, local: ${ourTip})`)
    return
  }

  const newBlocks = tipHeight - ourTip
  console.log(`Found ${newBlocks} new block(s)`)

  for (let height = ourTip + 1; height <= tipHeight; height++) {
    // Rate limit: small delay between requests
    if (height > ourTip + 1) await sleep(200)

    const hash = await getBlockHash(height)
    if (!hash) {
      console.log(`Could not get hash for block ${height}`)
      break
    }

    const block = await getBlock(hash)
    if (!block) {
      console.log(`Could not get block ${height}`)
      break
    }

    const header = headerFromApi(block)

    // Check if this completes an epoch
    const epochNum = Math.floor(height / 2016)
    const positionInEpoch = height % 2016

    if (epochNum > current.epoch) {
      // Archive the completed epoch
      archiveEpoch(current)

      // Start new current epoch
      current = {
        epoch: epochNum,
        start_height: epochNum * 2016,
        end_height: height,
        start_time: header.timestamp,
        end_time: header.timestamp,
        count: 1,
        headers: [header]
      }

      // Update archived count
      latest.archived_epochs.count = epochNum
      latest.archived_epochs.last = epochNum - 1
      latest.archived_epochs.blocks = epochNum * 2016 - 1
    } else {
      // Add to current epoch
      current.headers.push(header)
      current.end_height = height
      current.end_time = header.timestamp
      current.count = current.headers.length
    }

    // Update tip
    latest.tip.height = height
    latest.tip.hash = hash
    latest.tip.time = header.timestamp
    latest.current_epoch.count = current.count

    console.log(`Added block ${height} (epoch ${epochNum}, ${positionInEpoch + 1}/2016)`)
  }

  saveCurrent(current)
  saveLatest(latest)
  console.log(`Updated to height ${latest.tip.height}`)
}

const main = async () => {
  console.log(`Watching mempool.space for new blocks (polling every ${POLL_INTERVAL / 1000}s)`)
  console.log(`API: ${API_BASE}`)
  console.log(`Output dir: ${OUTPUT_DIR}`)
  console.log('')

  // Run immediately
  await checkForNewBlocks()

  // Then poll
  setInterval(checkForNewBlocks, POLL_INTERVAL)
}

main()
