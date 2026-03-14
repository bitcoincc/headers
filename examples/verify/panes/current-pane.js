export default {
  label: 'Current',
  icon: '\u{1F4C4}',

  canHandle(subject, store) {
    const node = store.get(subject.value)
    const type = store.type(node)
    return type && type.includes('Action')
  },

  render(subject, store, container) {
    const chain = new URLSearchParams(window.location.search).get('chain') || 'btc'
    const R2_BASE = 'https://pub-a5a92731dd0d452b9670be07e5354fd6.r2.dev/' + chain
    const HEADER_SIZE = 80
    const EPOCH_SIZE = 2016

    const style = document.createElement('style')
    style.textContent = `
      .current-pane { font-family: Georgia, 'Times New Roman', serif; max-width: 720px; margin: 0 auto; padding: 1rem; }
      .current-title { font-size: 1.5rem; margin-bottom: 0.5rem; }
      .current-subtitle { color: #666; margin-bottom: 1.5rem; }
      .current-status { padding: 1rem; border-radius: 4px; margin: 1rem 0; font-size: 0.9rem; }
      .current-status.waiting { background: #f5f4f0; color: #888; }
      .current-status.ok { background: rgba(45, 138, 78, 0.1); color: #2d8a4e; border: 1px solid rgba(45, 138, 78, 0.3); }
      .current-status.err { background: rgba(192, 57, 43, 0.1); color: #c0392b; border: 1px solid rgba(192, 57, 43, 0.3); }
      .current-status.info { background: rgba(247, 147, 26, 0.08); color: #555; border: 1px solid rgba(247, 147, 26, 0.2); }
      .current-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin: 1rem 0; }
      .current-stat-value { font-size: 1.25rem; font-weight: bold; color: #f7931a; }
      .current-stat-label { font-size: 0.75rem; color: #888; }
      .current-chain { font-family: monospace; font-size: 0.75rem; margin: 1rem 0; padding: 1rem; background: #f5f4f0; border-radius: 4px; max-height: 300px; overflow-y: auto; }
      .current-chain .link-ok { color: #2d8a4e; }
      .current-chain .link-err { color: #c0392b; }
      .current-chain .link-gap { color: #f7931a; }
      .current-btn { background: #f7931a; color: #fff; border: none; padding: 0.5rem 1.25rem; border-radius: 4px; cursor: pointer; font-size: 0.9rem; font-family: inherit; }
      .current-btn:hover { background: #e8850f; }
      .current-btn:disabled { background: #ccc; cursor: not-allowed; }
    `
    container.appendChild(style)

    const pane = document.createElement('div')
    pane.className = 'current-pane'
    container.appendChild(pane)

    const title = document.createElement('div')
    title.className = 'current-title'
    title.textContent = 'Current Epoch'
    pane.appendChild(title)

    const subtitle = document.createElement('div')
    subtitle.className = 'current-subtitle'
    subtitle.textContent = 'Fetch current.bin from R2 and verify it extends the archived chain.'
    pane.appendChild(subtitle)

    const btn = document.createElement('button')
    btn.className = 'current-btn'
    btn.textContent = 'Fetch Current Epoch'
    pane.appendChild(btn)

    const statusEl = document.createElement('div')
    statusEl.className = 'current-status waiting'
    statusEl.style.display = 'none'
    pane.appendChild(statusEl)

    const statsEl = document.createElement('div')
    statsEl.className = 'current-stats'
    statsEl.style.display = 'none'
    pane.appendChild(statsEl)

    const chainEl = document.createElement('div')
    chainEl.className = 'current-chain'
    chainEl.style.display = 'none'
    pane.appendChild(chainEl)

    // WASM SHA-256
    let hasher = null
    async function initHasher() {
      if (hasher) return
      const { createSHA256 } = await import('https://esm.sh/hash-wasm@4')
      hasher = await createSHA256()
    }
    function hash256sync(uint8arr) {
      hasher.init()
      hasher.update(uint8arr)
      const h1 = hasher.digest('binary')
      hasher.init()
      hasher.update(h1)
      return hasher.digest('binary')
    }
    function toHex(bytes) {
      return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
    }
    function getPrevHash(header) {
      const slice = header.slice(4, 36)
      const reversed = new Uint8Array(32)
      for (let i = 0; i < 32; i++) reversed[i] = slice[31 - i]
      return reversed
    }
    function getTimestamp(header) {
      const view = new DataView(header.buffer, header.byteOffset)
      return view.getUint32(68, true)
    }

    function setStatus(text, cls) {
      statusEl.textContent = text
      statusEl.className = 'current-status ' + cls
      statusEl.style.display = 'block'
    }

    function addChainLine(text, cls) {
      const line = document.createElement('div')
      line.className = cls || ''
      line.textContent = text
      chainEl.appendChild(line)
      chainEl.scrollTop = chainEl.scrollHeight
    }

    async function fetchAndVerify() {
      btn.disabled = true
      btn.textContent = 'Fetching...'
      chainEl.textContent = ''
      statsEl.style.display = 'none'

      try {
        await initHasher()

        // Fetch current.bin
        setStatus('Downloading current.bin...', 'info')
        const res = await fetch(R2_BASE + '/current.bin')
        if (!res.ok) throw new Error('Failed to fetch current.bin: ' + res.status)
        const data = new Uint8Array(await res.arrayBuffer())
        const count = data.length / HEADER_SIZE

        if (data.length % HEADER_SIZE !== 0) throw new Error('current.bin size not multiple of 80')

        chainEl.style.display = 'block'
        addChainLine('Downloaded ' + count + ' headers (' + (data.length / 1024).toFixed(1) + ' KB)', 'link-ok')

        // Determine epoch
        const firstHeader = data.subarray(0, HEADER_SIZE)
        const firstTimestamp = getTimestamp(firstHeader)
        const firstDate = new Date(firstTimestamp * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })

        const lastHeader = data.subarray((count - 1) * HEADER_SIZE, count * HEADER_SIZE)
        const lastHash = hash256sync(lastHeader)
        const lastHashReversed = new Uint8Array(32)
        for (let i = 0; i < 32; i++) lastHashReversed[i] = lastHash[31 - i]
        const lastTimestamp = getTimestamp(lastHeader)
        const lastDate = new Date(lastTimestamp * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })

        // Check if archive exists and verify linkage
        const archive = window._btcVerified
        let archiveTipHeight = -1
        let gapDetected = false

        if (archive) {
          archiveTipHeight = archive.tipHeight
          const archiveTipHash = archive.tipHash
          addChainLine('Archive tip: block ' + archiveTipHeight.toLocaleString() + ' (' + archiveTipHash.slice(0, 16) + '...)', 'link-ok')

          // The current epoch should start right after the archive tip
          // Or there may be overlap — check where the current epoch starts
          const firstPrevHash = getPrevHash(firstHeader)
          const firstPrevHex = toHex(firstPrevHash)

          // Find if first header's prev_hash matches archive tip
          const archiveTipHeader = archive.headers.subarray(archiveTipHeight * HEADER_SIZE, (archiveTipHeight + 1) * HEADER_SIZE)
          const archiveTipComputed = hash256sync(archiveTipHeader)
          const archiveTipComputedReversed = new Uint8Array(32)
          for (let i = 0; i < 32; i++) archiveTipComputedReversed[i] = archiveTipComputed[31 - i]
          const archiveTipComputedHex = toHex(archiveTipComputedReversed)

          // Current epoch might start at the epoch boundary, not right after archive tip
          // Find where it links
          const currentEpochStart = Math.floor((archiveTipHeight + 1) / EPOCH_SIZE) * EPOCH_SIZE
          const expectedFirstHeight = currentEpochStart

          if (archiveTipHeight >= expectedFirstHeight - 1) {
            // Check if first header in current.bin links to the corresponding archive header
            const linkHeight = expectedFirstHeight - 1
            const linkHeader = archive.headers.subarray(linkHeight * HEADER_SIZE, (linkHeight + 1) * HEADER_SIZE)
            const linkHash = hash256sync(linkHeader)
            const linkHashReversed = new Uint8Array(32)
            for (let i = 0; i < 32; i++) linkHashReversed[i] = linkHash[31 - i]
            const linkHashHex = toHex(linkHashReversed)

            if (firstPrevHex === linkHashHex) {
              addChainLine('\u2713 Current epoch links to archive at height ' + linkHeight.toLocaleString(), 'link-ok')
            } else {
              addChainLine('\u2717 BREAK: current epoch does not link to archive!', 'link-err')
              addChainLine('  Expected prev: ' + linkHashHex.slice(0, 16) + '...', 'link-err')
              addChainLine('  Got prev:      ' + firstPrevHex.slice(0, 16) + '...', 'link-err')
              gapDetected = true
            }
          } else {
            addChainLine('\u26A0 Gap between archive and current epoch', 'link-gap')
            gapDetected = true
          }
        } else {
          addChainLine('No archive verified yet \u2014 run Archive tab first to verify linkage', 'link-gap')
        }

        // Verify chain linkage within current epoch
        addChainLine('Verifying internal chain linkage...', '')
        let prevHash = null
        let linkErrors = 0
        for (let i = 0; i < count; i++) {
          const header = data.subarray(i * HEADER_SIZE, (i + 1) * HEADER_SIZE)
          const hashBytes = hash256sync(header)
          const hashReversed = new Uint8Array(32)
          for (let k = 0; k < 32; k++) hashReversed[k] = hashBytes[31 - k]

          if (prevHash) {
            const headerPrevHash = getPrevHash(header)
            let mismatch = false
            for (let k = 0; k < 32; k++) {
              if (prevHash[k] !== headerPrevHash[k]) { mismatch = true; break }
            }
            if (mismatch) {
              addChainLine('\u2717 Chain break at offset ' + i, 'link-err')
              linkErrors++
            }
          }
          prevHash = hashReversed
        }

        if (linkErrors === 0) {
          addChainLine('\u2713 All ' + count + ' headers internally linked', 'link-ok')
        }

        // Compute heights
        const epochNum = archive ? Math.floor((archive.tipHeight + 1) / EPOCH_SIZE) : '?'
        const startHeight = archive ? Math.floor((archive.tipHeight + 1) / EPOCH_SIZE) * EPOCH_SIZE : '?'
        const endHeight = archive ? startHeight + count - 1 : '?'

        addChainLine('Tip hash: ' + toHex(lastHashReversed), 'link-ok')

        // Show stats
        statsEl.style.display = 'grid'
        statsEl.textContent = ''
        const stats = [
          ['Epoch ' + epochNum, 'Current epoch'],
          [count.toString(), 'Headers'],
          [firstDate + ' \u2192 ' + lastDate, 'Date range'],
        ]
        stats.forEach(([v, l]) => {
          const el = document.createElement('div')
          const val = document.createElement('div')
          val.className = 'current-stat-value'
          val.textContent = v
          el.appendChild(val)
          const lab = document.createElement('div')
          lab.className = 'current-stat-label'
          lab.textContent = l
          el.appendChild(lab)
          statsEl.appendChild(el)
        })

        // Publish for Nostr pane
        const currentTipHeight = archive ? startHeight + count - 1 : count - 1
        window._btcCurrent = {
          headers: data,
          epochNum,
          startHeight: archive ? startHeight : 0,
          tipHeight: currentTipHeight,
          tipHash: toHex(lastHashReversed),
          linked: !gapDetected && linkErrors === 0
        }
        document.dispatchEvent(new CustomEvent('btc-current-verified', { detail: window._btcCurrent }))

        if (linkErrors === 0 && !gapDetected) {
          setStatus('\u2713 Current epoch verified: ' + count + ' headers, epoch ' + epochNum + ', linked to archive', 'ok')
        } else if (linkErrors === 0) {
          setStatus('\u26A0 Current epoch internally valid but gap with archive', 'info')
        } else {
          setStatus('\u2717 Current epoch has ' + linkErrors + ' chain errors', 'err')
        }

      } catch (err) {
        setStatus('Error: ' + err.message, 'err')
      }

      btn.disabled = false
      btn.textContent = 'Refresh'
    }

    btn.addEventListener('click', fetchAndVerify)
  }
}
