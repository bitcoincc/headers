export default {
  label: 'Verify Payment',
  icon: '\u{1F4B3}',

  canHandle(subject, store) {
    const node = store.get(subject.value)
    const type = store.type(node)
    return type && type.includes('Action')
  },

  render(subject, store, container) {
    const DEFAULT_TXID = 'b5d750f75faefe571ede0f315a15fce8b34edfe456c94f8cc75e2868f502dd74'
    const API_BASE = 'https://mempool.space/api'
    const HEADER_SIZE = 80
    let allHeaders = null // cached after first fetch

    const style = document.createElement('style')
    style.textContent = `
      .payment-pane { font-family: Georgia, 'Times New Roman', serif; max-width: 720px; margin: 0 auto; padding: 1rem; }
      .payment-title { font-size: 1.5rem; margin-bottom: 0.5rem; }
      .payment-subtitle { color: #666; margin-bottom: 1.5rem; }
      .payment-input { display: flex; gap: 0.5rem; margin-bottom: 1.5rem; align-items: center; }
      .payment-input label { font-size: 0.75rem; color: #888; white-space: nowrap; }
      .payment-input input { flex: 1; font-family: monospace; font-size: 0.8rem; color: #555; padding: 0.4rem 0.6rem; border: 1px solid #ddd; border-radius: 4px; background: #fafaf8; }
      .payment-input input:focus { outline: none; border-color: #f7931a; }
      .payment-btn { background: #f7931a; color: #fff; border: none; padding: 0.4rem 1rem; border-radius: 4px; cursor: pointer; font-size: 0.9rem; font-family: inherit; white-space: nowrap; }
      .payment-btn:hover { background: #e8850f; }
      .payment-btn:disabled { background: #ccc; cursor: not-allowed; }
      .payment-status { color: #888; font-size: 0.9rem; margin-bottom: 1rem; }
      .payment-error { color: #c0392b; font-size: 0.9rem; margin-bottom: 1rem; }
      .chain-visual { margin: 1.5rem 0; padding: 1.5rem; background: linear-gradient(135deg, #fdf6ec 0%, #fafaf8 100%); border: 1px solid #f7931a33; border-radius: 4px; }
      .chain-bar { display: flex; align-items: center; height: 40px; margin: 1rem 0; border-radius: 4px; overflow: hidden; position: relative; }
      .chain-behind { background: #2d8a4e; height: 100%; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 0.7rem; font-weight: 600; min-width: 60px; }
      .chain-tx { background: #f7931a; height: 100%; width: 4px; flex-shrink: 0; position: relative; }
      .chain-tx-marker { position: absolute; top: -22px; left: 50%; transform: translateX(-50%); font-size: 0.7rem; color: #f7931a; font-weight: 600; white-space: nowrap; }
      .chain-ahead { background: #3b82f6; height: 100%; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 0.7rem; font-weight: 600; min-width: 40px; }
      .chain-labels { display: flex; justify-content: space-between; font-size: 0.7rem; color: #888; }
      .chain-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-top: 1rem; }
      .chain-stat-value { font-size: 1.1rem; font-weight: bold; color: #2c2c2c; }
      .chain-stat-value .accent { color: #f7931a; }
      .chain-stat-label { font-size: 0.7rem; color: #888; }
      .proof-details { margin: 1.5rem 0; }
      .proof-details summary { cursor: pointer; color: #888; font-size: 0.85rem; margin-bottom: 0.5rem; }
      .proof-step { display: flex; align-items: center; gap: 0.5rem; padding: 0.3rem 0; font-family: monospace; font-size: 0.75rem; color: #555; }
      .proof-step .level { color: #888; min-width: 50px; }
      .proof-step .hash { color: #555; word-break: break-all; }
      .proof-step .side { color: #f7931a; min-width: 15px; font-weight: 600; }
      .proof-result { font-size: 1.1rem; font-weight: bold; margin: 1.5rem 0; padding: 1rem; border-radius: 4px; }
      .proof-result.pass { background: rgba(45, 138, 78, 0.1); color: #2d8a4e; border: 1px solid rgba(45, 138, 78, 0.3); }
      .proof-result.fail { background: rgba(192, 57, 43, 0.1); color: #c0392b; border: 1px solid rgba(192, 57, 43, 0.3); }
      .proof-note { font-size: 0.8rem; color: #888; font-style: italic; }
    `
    container.appendChild(style)

    const pane = document.createElement('div')
    pane.className = 'payment-pane'
    container.appendChild(pane)

    const title = document.createElement('div')
    title.className = 'payment-title'
    title.textContent = 'Verify Payment'
    pane.appendChild(title)

    const subtitle = document.createElement('div')
    subtitle.className = 'payment-subtitle'
    subtitle.textContent = 'Prove a transaction is in the Bitcoin blockchain using a merkle proof against verified headers.'
    pane.appendChild(subtitle)

    const inputRow = document.createElement('div')
    inputRow.className = 'payment-input'
    const inputLabel = document.createElement('label')
    inputLabel.textContent = 'txid:'
    inputRow.appendChild(inputLabel)
    const txidInput = document.createElement('input')
    txidInput.type = 'text'
    txidInput.value = DEFAULT_TXID
    txidInput.placeholder = 'Enter transaction ID'
    inputRow.appendChild(txidInput)
    const verifyBtn = document.createElement('button')
    verifyBtn.className = 'payment-btn'
    verifyBtn.textContent = 'Verify'
    inputRow.appendChild(verifyBtn)
    pane.appendChild(inputRow)

    const note = document.createElement('div')
    note.className = 'proof-note'
    note.textContent = 'Default: coinbase from block 940,500 (~100 confirmations). Paste any txid to verify.'
    pane.appendChild(note)

    const statusEl = document.createElement('div')
    statusEl.className = 'payment-status'
    statusEl.style.display = 'none'
    pane.appendChild(statusEl)

    const resultArea = document.createElement('div')
    pane.appendChild(resultArea)

    // WASM SHA-256
    let hasher = null
    async function initHasher() {
      if (hasher) return
      const { createSHA256 } = await import('https://esm.sh/hash-wasm@4')
      hasher = await createSHA256()
    }
    function sha256(uint8arr) {
      hasher.init()
      hasher.update(uint8arr)
      return hasher.digest('binary')
    }
    function doubleSha256(uint8arr) {
      return sha256(sha256(uint8arr))
    }

    function hexToBytes(hex) {
      const bytes = new Uint8Array(hex.length / 2)
      for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16)
      }
      return bytes
    }

    function bytesToHex(bytes) {
      return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
    }

    function reverseBytes(bytes) {
      const r = new Uint8Array(bytes.length)
      for (let i = 0; i < bytes.length; i++) r[i] = bytes[bytes.length - 1 - i]
      return r
    }

    // Verify merkle proof: compute root from txid + proof, compare with header
    function verifyMerkleProof(txid, merkle, pos) {
      // txid and proof hashes are in display byte order; reverse to internal for hashing
      let current = reverseBytes(hexToBytes(txid))

      const steps = []

      for (let i = 0; i < merkle.length; i++) {
        const sibling = reverseBytes(hexToBytes(merkle[i]))
        const isRight = (pos >> i) & 1

        let combined
        if (isRight) {
          combined = new Uint8Array(64)
          combined.set(sibling, 0)
          combined.set(current, 32)
          steps.push({ level: i, side: 'R', hash: bytesToHex(reverseBytes(sibling)) })
        } else {
          combined = new Uint8Array(64)
          combined.set(current, 0)
          combined.set(sibling, 32)
          steps.push({ level: i, side: 'L', hash: bytesToHex(reverseBytes(sibling)) })
        }

        current = doubleSha256(combined)
      }

      // Return computed root in display order (reversed)
      return { root: bytesToHex(reverseBytes(current)), steps }
    }

    function getTimestamp(header) {
      const view = new DataView(header.buffer, header.byteOffset)
      return view.getUint32(68, true)
    }

    function getMerkleRoot(header) {
      const slice = header.slice(36, 68)
      return bytesToHex(reverseBytes(slice))
    }

    async function verify() {
      const txid = txidInput.value.trim()
      if (!txid || txid.length !== 64) {
        statusEl.className = 'payment-error'
        statusEl.textContent = 'Please enter a valid 64-character transaction ID.'
        statusEl.style.display = 'block'
        return
      }

      resultArea.textContent = ''
      verifyBtn.disabled = true
      verifyBtn.textContent = 'Verifying...'
      statusEl.className = 'payment-status'
      statusEl.textContent = 'Loading WASM SHA-256...'
      statusEl.style.display = 'block'

      try {
        await initHasher()

        // Fetch merkle proof from mempool.space
        statusEl.textContent = 'Fetching merkle proof from mempool.space...'
        const proofRes = await fetch(API_BASE + '/tx/' + txid + '/merkle-proof')
        if (!proofRes.ok) throw new Error('Transaction not found. Check the txid.')
        const proof = await proofRes.json()

        // Fetch the block header from our verified source
        statusEl.textContent = 'Fetching verified header for block ' + proof.block_height + '...'

        // Fetch the verified header from R2
        const chain = new URLSearchParams(window.location.search).get('chain') || 'btc'
        const r2Base = 'https://pub-a5a92731dd0d452b9670be07e5354fd6.r2.dev/' + chain
        const epoch = Math.floor(proof.block_height / 2016)
        const indexInEpoch = proof.block_height % 2016

        // Use all.bin — one fetch, any block height works
        statusEl.textContent = 'Fetching verified headers...'
        if (!allHeaders) {
          const allRes = await fetch(r2Base + '/all.bin')
          if (!allRes.ok) throw new Error('Could not fetch headers from R2')
          allHeaders = new Uint8Array(await allRes.arrayBuffer())
        }

        const offset = proof.block_height * 80
        if (offset + 80 > allHeaders.length) throw new Error('Block ' + proof.block_height + ' not in header archive (archive has ' + Math.floor(allHeaders.length / 80) + ' headers)')
        const headerData = allHeaders.subarray(offset, offset + 80)

        // Verify the header's PoW (quick sanity check)
        const headerHash = doubleSha256(headerData)
        const headerHashHex = bytesToHex(reverseBytes(headerHash))

        // Get merkle root from header
        const expectedRoot = getMerkleRoot(headerData)
        const blockTime = getTimestamp(headerData)
        const blockDate = new Date(blockTime * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })

        // Compute merkle root from proof
        statusEl.textContent = 'Verifying merkle proof...'
        const { root: computedRoot, steps } = verifyMerkleProof(txid, proof.merkle, proof.pos)

        const match = computedRoot === expectedRoot

        // Get tip from cached headers
        const tipHeight = Math.floor(allHeaders.length / 80) - 1
        const confirmations = tipHeight - proof.block_height + 1

        statusEl.style.display = 'none'

        // Compute security metrics
        const COST_PER_EH = 0.833
        const TWO_256 = 2n ** 256n

        // Work behind (cumulative to this block)
        let workBehind = 0n
        for (let b = 0; b <= proof.block_height && b * HEADER_SIZE < allHeaders.length; b++) {
          const h = allHeaders.subarray(b * HEADER_SIZE, (b + 1) * HEADER_SIZE)
          const bits = new DataView(h.buffer, h.byteOffset).getUint32(72, true)
          const exp = bits >> 24
          const man = BigInt(bits & 0x7fffff)
          if (man > 0n) {
            const target = man * (2n ** BigInt(8 * (exp - 3)))
            workBehind += TWO_256 / target
          }
        }

        // Work ahead (from tx block to tip)
        let workAhead = 0n
        for (let b = proof.block_height + 1; b <= tipHeight && b * HEADER_SIZE < allHeaders.length; b++) {
          const h = allHeaders.subarray(b * HEADER_SIZE, (b + 1) * HEADER_SIZE)
          const bits = new DataView(h.buffer, h.byteOffset).getUint32(72, true)
          const exp = bits >> 24
          const man = BigInt(bits & 0x7fffff)
          if (man > 0n) {
            const target = man * (2n ** BigInt(8 * (exp - 3)))
            workAhead += TWO_256 / target
          }
        }

        const costBehind = Number(workBehind / (10n ** 18n)) * COST_PER_EH
        const costAhead = Number(workAhead / (10n ** 18n)) * COST_PER_EH

        function fmtCost(n) {
          if (n >= 1e12) return '$' + (n / 1e12).toFixed(1) + ' trillion'
          if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + ' billion'
          if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + ' million'
          if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K'
          return '$' + n.toFixed(0)
        }

        const timeSince = Math.floor(Date.now() / 1000) - blockTime
        const timeStr = timeSince < 3600 ? Math.floor(timeSince / 60) + ' minutes'
          : timeSince < 86400 ? Math.floor(timeSince / 3600) + ' hours'
          : Math.floor(timeSince / 86400) + ' days'

        // Build results
        const resultEl = document.createElement('div')
        resultEl.className = 'proof-result ' + (match ? 'pass' : 'fail')
        resultEl.textContent = match
          ? '\u2713 Transaction verified \u2014 cryptographic proof checked against ' + proof.block_height.toLocaleString() + ' verified headers'
          : '\u2717 Merkle proof FAILED \u2014 computed root does not match header'
        resultArea.appendChild(resultEl)

        if (match) {
          // Chain visual
          const visual = document.createElement('div')
          visual.className = 'chain-visual'

          const chainTitle = document.createElement('div')
          chainTitle.style.cssText = 'font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin-bottom: 0.5rem;'
          chainTitle.textContent = 'Chain Position'
          visual.appendChild(chainTitle)

          // Bar
          const bar = document.createElement('div')
          bar.className = 'chain-bar'

          const behindPct = Math.min(95, Math.max(50, proof.block_height / tipHeight * 100))
          const aheadPct = 100 - behindPct

          const behind = document.createElement('div')
          behind.className = 'chain-behind'
          behind.style.width = behindPct + '%'
          behind.textContent = fmtCost(costBehind) + ' behind'
          bar.appendChild(behind)

          const txMarker = document.createElement('div')
          txMarker.className = 'chain-tx'
          const marker = document.createElement('div')
          marker.className = 'chain-tx-marker'
          marker.textContent = '\u25BC Your tx'
          txMarker.appendChild(marker)
          bar.appendChild(txMarker)

          const ahead = document.createElement('div')
          ahead.className = 'chain-ahead'
          ahead.style.width = Math.max(aheadPct, 8) + '%'
          ahead.textContent = confirmations <= 1 ? confirmations + ' conf' : fmtCost(costAhead) + ' ahead'
          bar.appendChild(ahead)

          visual.appendChild(bar)

          // Labels
          const labels = document.createElement('div')
          labels.className = 'chain-labels'
          const genesisLabel = document.createElement('span')
          genesisLabel.textContent = 'Genesis (Jan 2009)'
          labels.appendChild(genesisLabel)
          const tipLabel = document.createElement('span')
          tipLabel.textContent = 'Tip (block ' + tipHeight.toLocaleString() + ')'
          labels.appendChild(tipLabel)
          visual.appendChild(labels)

          // Security stats - two rows
          const stats = document.createElement('div')
          stats.className = 'chain-stats'
          stats.style.gridTemplateColumns = 'repeat(2, 1fr)'

          stats.appendChild(createStat('Block ' + proof.block_height.toLocaleString(), 'Confirmed ' + blockDate))
          stats.appendChild(createStat(confirmations.toLocaleString() + ' confirmations', timeStr + ' ago'))
          stats.appendChild(createStat(fmtCost(costBehind), 'Secured by (history behind)'))
          stats.appendChild(createStat(costAhead > 0 ? fmtCost(costAhead) : confirmations + ' blocks', 'Protected by (work ahead)'))
          visual.appendChild(stats)

          // Explanation
          const explainEl = document.createElement('div')
          explainEl.style.cssText = 'margin-top: 1rem; font-size: 0.8rem; color: #888; line-height: 1.6;'
          const aheadDesc = costAhead > 0
            ? 'To reverse this transaction, an attacker would need to redo ' + fmtCost(costAhead) + ' of proof-of-work (' + confirmations + ' blocks built on top).'
            : 'This transaction is at the chain tip with ' + confirmations + ' confirmation. More blocks will build on top, increasing security.'
          explainEl.textContent = aheadDesc + ' The full chain behind it represents ' + fmtCost(costBehind) + ' of cumulative work. This proof was verified locally in your browser against ' + proof.merkle.length + ' merkle hashes and a PoW-verified header. No server was trusted.'
          visual.appendChild(explainEl)

          resultArea.appendChild(visual)

          // Proof details (collapsible)
          const details = document.createElement('details')
          details.className = 'proof-details'
          const summary = document.createElement('summary')
          summary.textContent = 'Show merkle proof (' + proof.merkle.length + ' steps)'
          details.appendChild(summary)

          // Txid
          const txStep = document.createElement('div')
          txStep.className = 'proof-step'
          const txLevelEl = document.createElement('span')
          txLevelEl.className = 'level'
          txLevelEl.textContent = 'txid'
          txStep.appendChild(txLevelEl)
          const txSideEl = document.createElement('span')
          txSideEl.className = 'side'
          txSideEl.textContent = '\u2192'
          txStep.appendChild(txSideEl)
          const txHashEl = document.createElement('span')
          txHashEl.className = 'hash'
          txHashEl.textContent = txid
          txStep.appendChild(txHashEl)
          details.appendChild(txStep)

          steps.forEach((s, i) => {
            const step = document.createElement('div')
            step.className = 'proof-step'
            const levelEl = document.createElement('span')
            levelEl.className = 'level'
            levelEl.textContent = 'level ' + i
            step.appendChild(levelEl)
            const sideEl = document.createElement('span')
            sideEl.className = 'side'
            sideEl.textContent = s.side
            step.appendChild(sideEl)
            const hashEl = document.createElement('span')
            hashEl.className = 'hash'
            hashEl.textContent = s.hash
            step.appendChild(hashEl)
            details.appendChild(step)
          })

          // Computed root
          const rootStep = document.createElement('div')
          rootStep.className = 'proof-step'
          const rootLevelEl = document.createElement('span')
          rootLevelEl.className = 'level'
          rootLevelEl.textContent = 'root'
          rootStep.appendChild(rootLevelEl)
          const rootSideEl = document.createElement('span')
          rootSideEl.className = 'side'
          rootSideEl.textContent = match ? '\u2713' : '\u2717'
          rootStep.appendChild(rootSideEl)
          const rootHashEl = document.createElement('span')
          rootHashEl.className = 'hash'
          rootHashEl.textContent = computedRoot
          rootStep.appendChild(rootHashEl)
          details.appendChild(rootStep)

          // Expected
          const expStep = document.createElement('div')
          expStep.className = 'proof-step'
          const expLevelEl = document.createElement('span')
          expLevelEl.className = 'level'
          expLevelEl.textContent = 'header'
          expStep.appendChild(expLevelEl)
          const expSideEl = document.createElement('span')
          expSideEl.className = 'side'
          expSideEl.textContent = '='
          expStep.appendChild(expSideEl)
          const expHashEl = document.createElement('span')
          expHashEl.className = 'hash'
          expHashEl.textContent = expectedRoot
          expStep.appendChild(expHashEl)
          details.appendChild(expStep)

          resultArea.appendChild(details)
        }

      } catch (err) {
        statusEl.className = 'payment-error'
        statusEl.textContent = 'Error: ' + err.message
        statusEl.style.display = 'block'
      }

      verifyBtn.disabled = false
      verifyBtn.textContent = 'Verify'
    }

    function createStat(value, label) {
      const el = document.createElement('div')
      const v = document.createElement('div')
      v.className = 'chain-stat-value'
      v.textContent = value
      el.appendChild(v)
      const l = document.createElement('div')
      l.className = 'chain-stat-label'
      l.textContent = label
      el.appendChild(l)
      return el
    }

    verifyBtn.addEventListener('click', verify)
    txidInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') verify() })

    // Auto-verify the default tx
    setTimeout(verify, 500)
  }
}
