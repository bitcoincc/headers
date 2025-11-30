#!/usr/bin/env node

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const BITCOIN_CLI = process.env.BITCOIN_CLI || 'bitcoin-cli'
const BITCOIN_DATADIR = process.env.BITCOIN_DATADIR || '/media/melvin/41/.bitcoin'
const OUTPUT_DIR = process.env.OUTPUT_DIR || './headers'
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL) || 30000 // 30 seconds

const cli = (cmd) => {
  const fullCmd = `${BITCOIN_CLI} -datadir=${BITCOIN_DATADIR} ${cmd}`
  try {
    return execSync(fullCmd, { encoding: 'utf8', timeout: 30000 }).trim()
  } catch (e) {
    console.error(`CLI error: ${e.message}`)
    return null
  }
}

const getBlockHeader = (hash) => {
  const result = cli(`getblockheader ${hash}`)
  if (!result) return null
  return JSON.parse(result)
}

const getBlockHash = (height) => {
  return cli(`getblockhash ${height}`)
}

const getBlockCount = () => {
  const result = cli('getblockcount')
  return result ? parseInt(result) : null
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
  const file = path.join(OUTPUT_DIR, 'epoch', `${epochData.epoch}.json`)
  fs.writeFileSync(file, JSON.stringify(epochData))
  console.log(`Archived epoch ${epochData.epoch}`)
}

const headerFromRpc = (rpcHeader, height) => ({
  height,
  version: rpcHeader.version,
  prev_block: rpcHeader.previousblockhash || '0'.repeat(64),
  merkle_root: rpcHeader.merkleroot,
  timestamp: rpcHeader.time,
  bits: rpcHeader.bits,
  nonce: rpcHeader.nonce,
  hash: rpcHeader.hash
})

const checkForNewBlocks = async () => {
  const blockCount = getBlockCount()
  if (blockCount === null) {
    console.log('Could not get block count, node may be unavailable')
    return
  }

  let latest = loadLatest()
  let current = loadCurrent()

  if (!latest || !current) {
    console.log('Missing latest.json or current.json, run extraction first')
    return
  }

  const tipHeight = latest.tip.height

  if (blockCount <= tipHeight) {
    console.log(`No new blocks (node: ${blockCount}, tip: ${tipHeight})`)
    return
  }

  console.log(`Found ${blockCount - tipHeight} new block(s)`)

  for (let height = tipHeight + 1; height <= blockCount; height++) {
    const hash = getBlockHash(height)
    if (!hash) {
      console.log(`Could not get hash for block ${height}`)
      break
    }

    const rpcHeader = getBlockHeader(hash)
    if (!rpcHeader) {
      console.log(`Could not get header for block ${height}`)
      break
    }

    const header = headerFromRpc(rpcHeader, height)

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

const main = () => {
  console.log(`Watching for new blocks (polling every ${POLL_INTERVAL / 1000}s)`)
  console.log(`Bitcoin datadir: ${BITCOIN_DATADIR}`)
  console.log(`Output dir: ${OUTPUT_DIR}`)
  console.log('')

  // Run immediately
  checkForNewBlocks()

  // Then poll
  setInterval(checkForNewBlocks, POLL_INTERVAL)
}

main()
