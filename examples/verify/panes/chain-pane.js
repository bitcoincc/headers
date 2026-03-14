export default {
  label: 'Full Chain',
  icon: '\u26D3',

  canHandle(subject, store) {
    const node = store.get(subject.value)
    const type = store.type(node)
    return type && type.includes('Action')
  },

  render(subject, store, container) {
    const R2_ROOT = 'https://pub-a5a92731dd0d452b9670be07e5354fd6.r2.dev'
    const chain = new URLSearchParams(window.location.search).get('chain') || 'btc'
    const R2_BASE = R2_ROOT + '/' + chain
    const RELAYS = [
      'wss://relay.damus.io',
      'wss://nos.lol',
      'wss://relay.nostr.net',
      'wss://relay.primal.net',
    ]
    const KIND = 33333
    const PUBKEY = 'cccccccc829b802b7bf52d43edf7cfe62ac89f332a318b6826ac8bd6e73660da'
    const HEADER_SIZE = 80
    const EPOCH_SIZE = 2016

    const style = document.createElement('style')
    style.textContent = `
      .chain-pane { font-family: Georgia, 'Times New Roman', serif; max-width: 720px; margin: 0 auto; padding: 1rem; }
      .chain-pane-title { font-size: 1.5rem; margin-bottom: 0.5rem; }
      .chain-pane-subtitle { color: #666; margin-bottom: 1.5rem; }
      .chain-btn { background: #f7931a; color: #fff; border: none; padding: 0.5rem 1.25rem; border-radius: 4px; cursor: pointer; font-size: 0.9rem; font-family: inherit; }
      .chain-btn:hover { background: #e8850f; }
      .chain-btn:disabled { background: #ccc; cursor: not-allowed; }
      .chain-phase { margin: 1rem 0; padding: 1rem; border-radius: 4px; border: 1px solid #eee; }
      .chain-phase-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
      .chain-phase-title { font-weight: 600; font-size: 0.95rem; }
      .chain-phase-badge { font-size: 0.7rem; padding: 0.2rem 0.6rem; border-radius: 3px; font-weight: 500; }
      .badge-pending { background: #f5f4f0; color: #888; }
      .badge-running { background: #fff3e0; color: #f7931a; }
      .badge-done { background: rgba(45, 138, 78, 0.1); color: #2d8a4e; }
      .badge-error { background: rgba(192, 57, 43, 0.1); color: #c0392b; }
      .badge-live { background: rgba(45, 138, 78, 0.1); color: #2d8a4e; animation: pulse-badge 2s infinite; }
      @keyframes pulse-badge { 50% { opacity: 0.6; } }
      .chain-phase-detail { font-size: 0.85rem; color: #666; }
      .chain-phase-bar { height: 4px; background: #eee; border-radius: 2px; margin-top: 0.5rem; overflow: hidden; }
      .chain-phase-fill { height: 100%; border-radius: 2px; transition: width 0.3s; }
      .fill-orange { background: #f7931a; }
      .fill-green { background: #2d8a4e; }
      .chain-unified { margin: 1.5rem 0; padding: 1.25rem; background: linear-gradient(135deg, #fdf6ec 0%, #fafaf8 100%); border: 1px solid #f7931a33; border-radius: 4px; }
      .chain-unified-title { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin-bottom: 0.75rem; }
      .chain-pipeline { display: flex; align-items: center; gap: 0; margin: 0.75rem 0; height: 36px; border-radius: 4px; overflow: hidden; }
      .chain-segment { height: 100%; display: flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: 600; color: #fff; min-width: 30px; }
      .seg-archive { background: #2d8a4e; }
      .seg-current { background: #3b82f6; }
      .seg-nostr { background: #f7931a; }
      .seg-gap { background: #eee; min-width: 10px; }
      .chain-pipeline-labels { display: flex; justify-content: space-between; font-size: 0.7rem; color: #888; }
      .chain-tip { font-size: 1.1rem; font-weight: bold; margin: 0.75rem 0; }
      .chain-tip-hash { font-family: monospace; font-size: 0.7rem; color: #666; word-break: break-all; }
      .chain-relays { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.5rem; }
      .chain-relay { font-family: monospace; font-size: 0.65rem; padding: 0.15rem 0.4rem; background: #f5f4f0; border-radius: 3px; display: flex; align-items: center; gap: 0.25rem; }
      .chain-relay-dot { width: 6px; height: 6px; border-radius: 50%; }
      .chain-live-stats { margin: 1rem 0; padding: 1rem; background: linear-gradient(135deg, #fdf6ec 0%, #fafaf8 100%); border: 1px solid #f7931a33; border-radius: 4px; }
      .chain-live-stats-title { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin-bottom: 0.75rem; }
      .chain-live-stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.75rem 1rem; }
      .chain-live-stat-value { font-size: 1.1rem; font-weight: bold; color: #2c2c2c; }
      .chain-live-stat-value .unit { font-size: 0.75rem; font-weight: normal; color: #888; }
      .chain-live-stat-label { font-size: 0.7rem; color: #888; }
    `
    container.appendChild(style)

    const pane = document.createElement('div')
    pane.className = 'chain-pane'
    container.appendChild(pane)

    const title = document.createElement('div')
    title.className = 'chain-pane-title'
    title.textContent = 'Full Chain Verification'
    pane.appendChild(title)

    const subtitle = document.createElement('div')
    subtitle.className = 'chain-pane-subtitle'
    subtitle.textContent = 'Archive (R2) + Current Epoch (R2) + Live Stream (Nostr) = Genesis to Tip'
    pane.appendChild(subtitle)

    const btn = document.createElement('button')
    btn.className = 'chain-btn'
    btn.textContent = 'Verify Full Chain'
    pane.appendChild(btn)

    // Phase cards
    const phase1 = createPhase('1. Archive Headers', 'Download and verify all.bin from R2')
    const phase2 = createPhase('2. Current Epoch', 'Fetch current.bin and verify linkage')
    const phase3 = createPhase('3. Nostr Live', 'Connect to relays for real-time tip')
    pane.appendChild(phase1.el)
    pane.appendChild(phase2.el)
    pane.appendChild(phase3.el)

    // Live stats panel (updates during verification)
    const liveStats = document.createElement('div')
    liveStats.className = 'chain-live-stats'
    liveStats.style.display = 'none'
    pane.appendChild(liveStats)

    const liveTitle = document.createElement('div')
    liveTitle.className = 'chain-live-stats-title'
    liveTitle.textContent = 'Cumulative Proof-of-Work'
    liveStats.appendChild(liveTitle)

    const liveGrid = document.createElement('div')
    liveGrid.className = 'chain-live-stats-grid'
    liveStats.appendChild(liveGrid)

    function createLiveStat(value, label) {
      const el = document.createElement('div')
      const v = document.createElement('div')
      v.className = 'chain-live-stat-value'
      v.textContent = value
      el.appendChild(v)
      const l = document.createElement('div')
      l.className = 'chain-live-stat-label'
      l.textContent = label
      el.appendChild(l)
      return el
    }

    const lsDate = createLiveStat('---', 'Block date')
    const lsHeight = createLiveStat('0', 'Block height')
    const lsWork = createLiveStat('0', 'Total work (log\u2082)')
    const lsHashes = createLiveStat('0', 'Estimated hashes')
    const lsCost = createLiveStat('$0', 'Approx. cost to reproduce')
    const lsZeros = createLiveStat('0', 'Max leading zero bits')
    liveGrid.appendChild(lsDate)
    liveGrid.appendChild(lsHeight)
    liveGrid.appendChild(lsWork)
    liveGrid.appendChild(lsHashes)
    liveGrid.appendChild(lsCost)
    liveGrid.appendChild(lsZeros)

    function updateLiveStat(el, html) {
      el.querySelector('.chain-live-stat-value').innerHTML = html
    }

    // Results table
    const htfuContainer = document.createElement('div')
    htfuContainer.style.display = 'none'
    pane.appendChild(htfuContainer)

    // Unified view
    const unified = document.createElement('div')
    unified.className = 'chain-unified'
    unified.style.display = 'none'
    pane.appendChild(unified)

    function createPhase(name, detail) {
      const el = document.createElement('div')
      el.className = 'chain-phase'

      const header = document.createElement('div')
      header.className = 'chain-phase-header'

      const titleEl = document.createElement('div')
      titleEl.className = 'chain-phase-title'
      titleEl.textContent = name
      header.appendChild(titleEl)

      const badge = document.createElement('span')
      badge.className = 'chain-phase-badge badge-pending'
      badge.textContent = 'Pending'
      header.appendChild(badge)
      el.appendChild(header)

      const detailEl = document.createElement('div')
      detailEl.className = 'chain-phase-detail'
      detailEl.textContent = detail
      el.appendChild(detailEl)

      const bar = document.createElement('div')
      bar.className = 'chain-phase-bar'
      bar.style.display = 'none'
      const fill = document.createElement('div')
      fill.className = 'chain-phase-fill fill-orange'
      fill.style.width = '0%'
      bar.appendChild(fill)
      el.appendChild(bar)

      return { el, badge, detail: detailEl, bar, fill }
    }

    function setBadge(phase, text, cls) {
      phase.badge.textContent = text
      phase.badge.className = 'chain-phase-badge ' + cls
    }

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
    function hexToBytes(hex) {
      const bytes = new Uint8Array(hex.length / 2)
      for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substr(i, 2), 16)
      return bytes
    }
    function getPrevHash(header) {
      const slice = header.slice(4, 36)
      const r = new Uint8Array(32)
      for (let i = 0; i < 32; i++) r[i] = slice[31 - i]
      return r
    }
    function getTimestamp(header) {
      return new DataView(header.buffer, header.byteOffset).getUint32(68, true)
    }
    function headerHash(header) {
      const h = hash256sync(header)
      const r = new Uint8Array(32)
      for (let i = 0; i < 32; i++) r[i] = h[31 - i]
      return toHex(r)
    }

    // Format helpers
    const COST_PER_EH = 0.833
    const TWO_256 = 2n ** 256n

    function formatHashes(work) {
      if (work === 0n) return '0'
      const s = work.toString()
      const d = s.length
      if (d <= 6) return Number(work).toLocaleString()
      return s[0] + '.' + s.slice(1, 4) + ' \u00d7 10^' + (d - 1)
    }

    function formatDollars(n) {
      if (n >= 1e15) return '$' + (n / 1e15).toFixed(3) + ' quadrillion'
      if (n >= 1e12) return '$' + (n / 1e12).toFixed(3) + ' trillion'
      if (n >= 1e9) return '$' + (n / 1e9).toFixed(3) + ' billion'
      if (n >= 1e6) return '$' + (n / 1e6).toFixed(3) + ' million'
      if (n >= 1e3) return '$' + (n / 1e3).toFixed(2) + 'K'
      return '$' + n.toFixed(0)
    }

    function log2BigInt(n) {
      if (n <= 0n) return 0
      return n.toString(2).length - 1
    }

    function countLeadingZeroBits(hashReversed) {
      let zeros = 0
      for (let i = 0; i < 32; i++) {
        if (hashReversed[i] === 0) { zeros += 8; continue }
        let byte = hashReversed[i]
        while ((byte & 0x80) === 0) { zeros++; byte <<= 1 }
        break
      }
      return zeros
    }

    function workFromBits(bits) {
      const exp = bits >> 24
      const man = BigInt(bits & 0x7fffff)
      if (man === 0n) return 0n
      const target = man * (2n ** BigInt(8 * (exp - 3)))
      if (target === 0n) return 0n
      return TWO_256 / target
    }

    function updateLiveDisplay(totalWork, maxZeros) {
      const log2W = log2BigInt(totalWork)
      updateLiveStat(lsWork, '2<sup>' + log2W + '</sup> <span class="unit">hashes of work</span>')
      updateLiveStat(lsHashes, formatHashes(totalWork))
      const workInEH = totalWork / (10n ** 18n)
      const cost = Number(workInEH) * COST_PER_EH
      updateLiveStat(lsCost, formatDollars(cost))
      updateLiveStat(lsZeros, maxZeros + ' <span class="unit">bits (difficulty frontier)</span>')
    }

    // BIP activation heights
    const BIP34_HEIGHT = 227931
    const BIP66_HEIGHT = 363725
    const BIP65_HEIGHT = 388381
    const EXPECTED_EPOCH_TIME = EPOCH_SIZE * 600

    // H-class rule counters
    const rules = {
      genesis:  { checked: 0, passed: 0 },
      linkage:  { checked: 0, passed: 0 },
      pow:      { checked: 0, passed: 0 },
      retarget: { checked: 0, passed: 0 },
      median:   { checked: 0, passed: 0 },
      version:  { checked: 0, passed: 0 },
    }

    function getBits(header) {
      return new DataView(header.buffer, header.byteOffset).getUint32(72, true)
    }
    function getVersion(header) {
      return new DataView(header.buffer, header.byteOffset).getInt32(0, true)
    }
    function decodeBits(bits) {
      const exp = bits >> 24
      const man = BigInt(bits & 0x7fffff)
      if (man === 0n) return 0n
      return man * (2n ** BigInt(8 * (exp - 3)))
    }
    function encodeBits(target) {
      if (target === 0n) return 0
      let hex = target.toString(16)
      if (hex.length % 2 !== 0) hex = '0' + hex
      let exponent = hex.length / 2
      let mantissa = parseInt(hex.slice(0, 6), 16)
      if (mantissa & 0x800000) { mantissa >>= 8; exponent++ }
      return (exponent << 24) | mantissa
    }
    function median(arr) {
      const sorted = arr.slice().sort((a, b) => a - b)
      return sorted[Math.floor(sorted.length / 2)]
    }
    function verifyPoW(header, hashReversed) {
      const bits = getBits(header)
      const exp = bits >> 24
      const man = bits & 0x7fffff
      const target = new Uint8Array(32)
      const bi = 32 - exp
      if (bi >= 0 && bi < 32) target[bi] = (man >> 16) & 0xff
      if (bi + 1 >= 0 && bi + 1 < 32) target[bi + 1] = (man >> 8) & 0xff
      if (bi + 2 >= 0 && bi + 2 < 32) target[bi + 2] = man & 0xff
      for (let i = 0; i < 32; i++) {
        if (hashReversed[i] < target[i]) return true
        if (hashReversed[i] > target[i]) return false
      }
      return true
    }
    const MAX_TARGET = 0x00000000FFFFn * (2n ** 208n)
    function verifyRetarget(data, height) {
      if (height === 0 || height % EPOCH_SIZE !== 0) return true
      const epochStart = height - EPOCH_SIZE
      const firstH = data.subarray(epochStart * HEADER_SIZE, (epochStart + 1) * HEADER_SIZE)
      const lastH = data.subarray((height - 1) * HEADER_SIZE, height * HEADER_SIZE)
      const newH = data.subarray(height * HEADER_SIZE, (height + 1) * HEADER_SIZE)
      let actualTime = getTimestamp(lastH) - getTimestamp(firstH)
      if (actualTime < EXPECTED_EPOCH_TIME / 4) actualTime = EXPECTED_EPOCH_TIME / 4
      if (actualTime > EXPECTED_EPOCH_TIME * 4) actualTime = EXPECTED_EPOCH_TIME * 4
      let newTarget = decodeBits(getBits(lastH)) * BigInt(actualTime) / BigInt(EXPECTED_EPOCH_TIME)
      if (newTarget > MAX_TARGET) newTarget = MAX_TARGET
      return encodeBits(newTarget) === getBits(newH)
    }

    function buildResultsTable(elapsed) {
      const log2W = log2BigInt(window._btcVerified?.totalWork || 0n)
      const workInEH = (window._btcVerified?.totalWork || 0n) / (10n ** 18n)
      const cost = Number(workInEH) * COST_PER_EH

      const table = document.createElement('table')
      table.className = 'chain-results-table'
      table.style.cssText = 'width:100%;border-collapse:collapse;margin:1.5rem 0;font-size:0.85rem;'

      const thead = document.createElement('thead')
      const headRow = document.createElement('tr')
      ;['Consensus Rule', '', 'Checked', 'Passed', 'Status'].forEach(h => {
        const th = document.createElement('th')
        th.style.cssText = 'text-align:left;padding:0.5rem 0.75rem;border-bottom:2px solid #ddd;color:#888;font-weight:500;'
        th.textContent = h
        headRow.appendChild(th)
      })
      thead.appendChild(headRow)
      table.appendChild(thead)

      const tbody = document.createElement('tbody')

      function addSection(label) {
        const tr = document.createElement('tr')
        const td = document.createElement('td')
        td.colSpan = 5
        td.style.cssText = 'padding-top:1rem;font-weight:600;color:#555;border-bottom:1px solid #ddd;font-size:0.8rem;'
        td.textContent = label
        tr.appendChild(td)
        tbody.appendChild(tr)
      }

      function addRule(name, checked, passed, evidence) {
        const tr = document.createElement('tr')
        tr.style.cssText = 'cursor:default;'
        tr.onmouseover = () => { tr.querySelectorAll('td').forEach(td => td.style.background = '#f5f4f0') }
        tr.onmouseout = () => { tr.querySelectorAll('td').forEach(td => td.style.background = '') }

        const tdName = document.createElement('td')
        tdName.style.cssText = 'padding:0.5rem 0.75rem;border-bottom:1px solid #eee;font-weight:500;'
        tdName.textContent = name
        tr.appendChild(tdName)

        const tdBadge = document.createElement('td')
        tdBadge.style.cssText = 'padding:0.5rem 0.75rem;border-bottom:1px solid #eee;'
        const badge = document.createElement('span')
        badge.style.cssText = 'display:inline-block;width:22px;height:22px;border-radius:3px;text-align:center;line-height:22px;font-size:0.7rem;font-weight:600;color:#fff !important;background:#2d8a4e;'
        badge.textContent = 'H'
        tdBadge.appendChild(badge)
        tr.appendChild(tdBadge)

        const tdChecked = document.createElement('td')
        tdChecked.style.cssText = 'padding:0.5rem 0.75rem;border-bottom:1px solid #eee;'
        tdChecked.textContent = checked.toLocaleString()
        tr.appendChild(tdChecked)

        const tdPassed = document.createElement('td')
        tdPassed.style.cssText = 'padding:0.5rem 0.75rem;border-bottom:1px solid #eee;'
        tdPassed.textContent = passed.toLocaleString()
        tr.appendChild(tdPassed)

        const tdStatus = document.createElement('td')
        tdStatus.style.cssText = 'padding:0.5rem 0.75rem;border-bottom:1px solid #eee;font-weight:bold;color:' + (checked === passed ? '#2d8a4e' : '#c0392b') + ';'
        tdStatus.textContent = checked === passed ? '\u2713 Pass' : '\u2717 ' + (checked - passed) + ' failures'
        tr.appendChild(tdStatus)

        tbody.appendChild(tr)

        if (evidence) {
          const trEv = document.createElement('tr')
          const tdEv = document.createElement('td')
          tdEv.colSpan = 5
          tdEv.style.cssText = 'padding:0.25rem 0.75rem;border-bottom:1px solid #eee;font-size:0.75rem;color:#888;'
          tdEv.textContent = evidence
          trEv.appendChild(tdEv)
          tbody.appendChild(trEv)
        }
      }

      addSection('H \u2014 Header-Only (verified from 80-byte headers)')
      addRule('Genesis block hash matches', rules.genesis.checked, rules.genesis.passed, 'First header \u2192 known hash')
      addRule('Previous block hash links correctly', rules.linkage.checked, rules.linkage.passed, 'Adjacent headers')
      addRule('Proof-of-work meets difficulty target', rules.pow.checked, rules.pow.passed, 'Block header (80 bytes)')
      addRule('Difficulty retarget is correct', rules.retarget.checked, rules.retarget.passed, 'Previous 2016 headers')
      addRule('Timestamp > median of previous 11', rules.median.checked, rules.median.passed, 'Previous 11 headers')
      addRule('Block version valid for height', rules.version.checked, rules.version.passed, 'Header + height')

      table.appendChild(tbody)

      const tfoot = document.createElement('tfoot')
      const footRow = document.createElement('tr')
      const footTd = document.createElement('td')
      footTd.colSpan = 5
      footTd.style.cssText = 'padding-top:1rem;font-size:0.8rem;color:#888;border-bottom:none;'
      footTd.textContent = 'Verified ' + (archiveTip + 1).toLocaleString() + ' headers \u00b7 2^' + log2W + ' work \u00b7 ' + formatDollars(cost) + ' to reproduce \u00b7 ' + elapsed + 's'
      footRow.appendChild(footTd)
      tfoot.appendChild(footRow)
      table.appendChild(tfoot)

      return table
    }

    // State
    let archiveData = null
    let archiveTip = -1
    let archiveTipHash = ''
    let maxZeros = 0
    let currentTip = -1
    let currentTipHash = ''
    let nostrTip = -1
    let nostrTipHash = ''
    let relayStatus = {}
    let nostrSockets = {}

    function updateUnified() {
      unified.style.display = 'block'
      unified.textContent = ''

      const utitle = document.createElement('div')
      utitle.className = 'chain-unified-title'
      utitle.textContent = 'Verified Chain'
      unified.appendChild(utitle)

      // Pipeline bar
      const pipeline = document.createElement('div')
      pipeline.className = 'chain-pipeline'

      const bestTip = Math.max(archiveTip, currentTip, nostrTip)
      if (bestTip <= 0) return

      if (archiveTip > 0) {
        const seg = document.createElement('div')
        seg.className = 'chain-segment seg-archive'
        seg.style.width = (archiveTip / bestTip * 100) + '%'
        seg.textContent = 'Archive'
        pipeline.appendChild(seg)
      }

      if (currentTip > archiveTip) {
        const seg = document.createElement('div')
        seg.className = 'chain-segment seg-current'
        seg.style.width = ((currentTip - archiveTip) / bestTip * 100) + '%'
        seg.textContent = 'Current'
        pipeline.appendChild(seg)
      }

      if (nostrTip > currentTip && nostrTip > archiveTip) {
        const base = Math.max(archiveTip, currentTip)
        const gap = nostrTip - base
        const seg = document.createElement('div')
        seg.className = 'chain-segment seg-nostr'
        seg.style.width = Math.max(5, gap / bestTip * 100) + '%'
        seg.textContent = 'Live'
        pipeline.appendChild(seg)
      }

      unified.appendChild(pipeline)

      // Labels
      const labels = document.createElement('div')
      labels.className = 'chain-pipeline-labels'
      const genesis = document.createElement('span')
      genesis.textContent = 'Genesis (2009)'
      labels.appendChild(genesis)
      const tip = document.createElement('span')
      tip.textContent = 'Tip (' + bestTip.toLocaleString() + ')'
      labels.appendChild(tip)
      unified.appendChild(labels)

      // Tip info
      const bestHash = nostrTip >= currentTip ? (nostrTip >= archiveTip ? nostrTipHash : archiveTipHash) : (currentTip >= archiveTip ? currentTipHash : archiveTipHash)
      const tipEl = document.createElement('div')
      tipEl.className = 'chain-tip'
      tipEl.textContent = 'Block ' + bestTip.toLocaleString()
      unified.appendChild(tipEl)

      const hashEl = document.createElement('div')
      hashEl.className = 'chain-tip-hash'
      hashEl.textContent = bestHash
      unified.appendChild(hashEl)

      // Relay status
      if (Object.keys(relayStatus).length > 0) {
        const relays = document.createElement('div')
        relays.className = 'chain-relays'
        Object.entries(relayStatus).forEach(([url, s]) => {
          const tag = document.createElement('div')
          tag.className = 'chain-relay'
          const dot = document.createElement('div')
          dot.className = 'chain-relay-dot'
          dot.style.background = s === 'connected' ? '#2d8a4e' : s === 'connecting' ? '#b8860b' : '#c0392b'
          tag.appendChild(dot)
          tag.appendChild(document.createTextNode(url.replace('wss://', '')))
          relays.appendChild(tag)
        })
        unified.appendChild(relays)
      }
    }

    // Phase 1: Archive
    async function runArchive() {
      setBadge(phase1, 'Downloading...', 'badge-running')
      phase1.bar.style.display = 'block'
      phase1.fill.style.width = '0%'

      const res = await fetch(R2_BASE + '/all.bin')
      if (!res.ok) throw new Error('Failed to fetch all.bin')

      const contentLength = parseInt(res.headers.get('content-length') || '0')
      const reader = res.body.getReader()
      const chunks = []
      let received = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        received += value.length
        if (contentLength) {
          const pct = (received / contentLength * 100).toFixed(0)
          phase1.fill.style.width = pct + '%'
          phase1.detail.textContent = 'Downloading... ' + (received / 1024 / 1024).toFixed(1) + ' MB'
        }
      }

      archiveData = new Uint8Array(received)
      let offset = 0
      for (const chunk of chunks) { archiveData.set(chunk, offset); offset += chunk.length }

      const totalHeaders = archiveData.length / HEADER_SIZE
      setBadge(phase1, 'Verifying...', 'badge-running')
      phase1.fill.className = 'chain-phase-fill fill-green'
      phase1.fill.style.width = '0%'

      // Full H-class verification with live stats
      liveStats.style.display = 'block'
      Object.values(rules).forEach(r => { r.checked = 0; r.passed = 0 })
      let prevHash = null
      let totalWork = 0n
      maxZeros = 0
      const prevTimestamps = []
      const BATCH = 2000
      const startTime = performance.now()

      // Genesis check
      const GENESIS_HASHES = {
        btc: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
        tbtc4: '00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043',
      }
      const GENESIS_HASH = GENESIS_HASHES[chain] || GENESIS_HASHES.btc

      for (let i = 0; i < totalHeaders; i += BATCH) {
        const end = Math.min(i + BATCH, totalHeaders)
        for (let j = i; j < end; j++) {
          const header = archiveData.subarray(j * HEADER_SIZE, (j + 1) * HEADER_SIZE)
          const h = hash256sync(header)
          const hr = new Uint8Array(32)
          for (let k = 0; k < 32; k++) hr[k] = h[31 - k]
          const bits = getBits(header)
          const timestamp = getTimestamp(header)
          const version = getVersion(header)

          // 1. Genesis
          if (j === 0) {
            rules.genesis.checked++
            if (toHex(hr) === GENESIS_HASH) rules.genesis.passed++
          }

          // 2. Chain linkage
          rules.linkage.checked++
          if (prevHash) {
            const ph = getPrevHash(header)
            let ok = true
            for (let k = 0; k < 32; k++) { if (prevHash[k] !== ph[k]) { ok = false; break } }
            if (ok) rules.linkage.passed++
          } else {
            rules.linkage.passed++
          }

          // 3. PoW (sampled)
          if (j < 1000 || j % 100 === 0) {
            rules.pow.checked++
            if (verifyPoW(header, hr)) rules.pow.passed++
          }

          // 4. Retarget (mainnet only — testnets allow difficulty reset)
          if (chain === 'btc' && j > 0 && j % EPOCH_SIZE === 0) {
            rules.retarget.checked++
            if (verifyRetarget(archiveData, j)) rules.retarget.passed++
          }

          // 5. Median time
          if (prevTimestamps.length >= 11) {
            rules.median.checked++
            if (timestamp >= median(prevTimestamps.slice(-11))) rules.median.passed++
          }
          prevTimestamps.push(timestamp)
          if (prevTimestamps.length > 12) prevTimestamps.shift()

          // 6. Version (mainnet activation heights only)
          if (chain === 'btc') {
            rules.version.checked++
            let vOk = true
            if (j >= BIP65_HEIGHT && version < 4) vOk = false
            else if (j >= BIP66_HEIGHT && version < 3) vOk = false
            else if (j >= BIP34_HEIGHT && version < 2) vOk = false
            if (vOk) rules.version.passed++
          }

          // Track work and difficulty
          totalWork += workFromBits(bits)
          const zeros = countLeadingZeroBits(hr)
          if (zeros > maxZeros) maxZeros = zeros

          prevHash = hr
        }

        // Update progress bar
        phase1.fill.style.width = (end / totalHeaders * 100).toFixed(0) + '%'
        phase1.detail.textContent = 'Verifying... ' + end.toLocaleString() + ' / ' + totalHeaders.toLocaleString()

        // Update live stats
        updateLiveStat(lsHeight, (end - 1).toLocaleString())
        const lastH = archiveData.subarray((end - 1) * HEADER_SIZE, end * HEADER_SIZE)
        const ts = new DataView(lastH.buffer, lastH.byteOffset).getUint32(68, true)
        updateLiveStat(lsDate, new Date(ts * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }))
        updateLiveDisplay(totalWork, maxZeros)

        await new Promise(r => setTimeout(r, 0))
      }

      const elapsed = ((performance.now() - startTime) / 1000).toFixed(1)
      archiveTip = totalHeaders - 1
      archiveTipHash = toHex(prevHash)

      const totalErrors = Object.values(rules).reduce((sum, r) => sum + (r.checked - r.passed), 0)
      phase1.detail.textContent = totalHeaders.toLocaleString() + ' headers verified \u2014 tip: block ' + archiveTip.toLocaleString()
      setBadge(phase1, totalErrors === 0 ? '\u2713 Verified' : '\u2717 ' + totalErrors + ' errors', totalErrors === 0 ? 'badge-done' : 'badge-error')
      phase1.fill.style.width = '100%'

      // Show results table
      htfuContainer.textContent = ''
      htfuContainer.appendChild(buildResultsTable(elapsed))
      htfuContainer.style.display = 'block'

      // Publish
      window._btcVerified = { headers: archiveData, tipHeight: archiveTip, tipHash: archiveTipHash, totalWork }
      updateUnified()
    }

    // Phase 2: Current Epoch
    async function runCurrent() {
      setBadge(phase2, 'Fetching...', 'badge-running')
      phase2.bar.style.display = 'block'
      phase2.fill.style.width = '50%'
      phase2.fill.className = 'chain-phase-fill fill-orange'

      const res = await fetch(R2_BASE + '/current.bin')
      if (!res.ok) throw new Error('Failed to fetch current.bin')
      const data = new Uint8Array(await res.arrayBuffer())
      const count = data.length / HEADER_SIZE

      phase2.fill.style.width = '75%'
      setBadge(phase2, 'Verifying...', 'badge-running')

      // Current epoch starts at an epoch boundary
      // Its first header's prev_hash links to the block before that boundary
      const firstHeader = data.subarray(0, HEADER_SIZE)
      const firstPrevHash = toHex(getPrevHash(firstHeader))

      // Find which block in the archive this links to
      let linked = false
      let epochStart = 0
      if (archiveData) {
        // Try each epoch boundary to find where current.bin starts
        const archiveEpoch = Math.floor(archiveTip / EPOCH_SIZE)
        epochStart = archiveEpoch * EPOCH_SIZE

        // current.bin's first header links to block (epochStart - 1)
        if (epochStart > 0 && epochStart <= archiveTip + 1) {
          const linkHeight = epochStart - 1
          const linkHeader = archiveData.subarray(linkHeight * HEADER_SIZE, (linkHeight + 1) * HEADER_SIZE)
          const linkHash = headerHash(linkHeader)
          if (firstPrevHash === linkHash) {
            linked = true
          }
        }
      }

      // Verify internal linkage
      let prevHash = null
      for (let i = 0; i < count; i++) {
        const header = data.subarray(i * HEADER_SIZE, (i + 1) * HEADER_SIZE)
        const h = hash256sync(header)
        const hr = new Uint8Array(32)
        for (let k = 0; k < 32; k++) hr[k] = h[31 - k]

        if (prevHash) {
          const ph = getPrevHash(header)
          for (let k = 0; k < 32; k++) {
            if (prevHash[k] !== ph[k]) throw new Error('Current epoch chain break at offset ' + i)
          }
        }
        prevHash = hr
      }

      const epochNum = Math.floor(epochStart / EPOCH_SIZE)
      currentTip = linked ? epochStart + count - 1 : count - 1
      currentTipHash = toHex(prevHash)

      // Update live stats with current epoch tip
      if (linked && window._btcVerified && window._btcVerified.totalWork) {
        // Add work from headers beyond archive tip
        let extraWork = window._btcVerified.totalWork
        const archiveEnd = archiveTip - epochStart + 1 // headers already counted in archive
        for (let i = archiveEnd; i < count; i++) {
          const header = data.subarray(i * HEADER_SIZE, (i + 1) * HEADER_SIZE)
          const bits = new DataView(header.buffer, header.byteOffset).getUint32(72, true)
          extraWork += workFromBits(bits)
        }
        const lastTs = new DataView(data.buffer, data.byteOffset + (count - 1) * HEADER_SIZE + 68).getUint32(0, true)
        updateLiveStat(lsHeight, currentTip.toLocaleString())
        updateLiveStat(lsDate, new Date(lastTs * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }))
        updateLiveDisplay(extraWork, maxZeros)
      }

      const statusText = count + ' headers' + (linked ? ' \u2014 linked to archive' : ' \u2014 gap (archive may be behind)')
      phase2.detail.textContent = 'Epoch ' + epochNum + ': ' + statusText + ' \u2014 tip: block ' + currentTip.toLocaleString()
      setBadge(phase2, linked ? '\u2713 Linked' : '\u26A0 Gap', linked ? 'badge-done' : 'badge-running')
      phase2.fill.className = 'chain-phase-fill fill-green'
      phase2.fill.style.width = '100%'

      window._btcCurrent = { tipHeight: currentTip, tipHash: currentTipHash, linked }
      updateUnified()
    }

    // Phase 3: Nostr
    function runNostr() {
      setBadge(phase3, 'Connecting...', 'badge-running')

      RELAYS.forEach(url => {
        relayStatus[url] = 'connecting'

        const ws = new WebSocket(url)
        nostrSockets[url] = ws

        ws.onopen = () => {
          relayStatus[url] = 'connected'
          const connCount = Object.values(relayStatus).filter(s => s === 'connected').length
          phase3.detail.textContent = connCount + '/' + RELAYS.length + ' relays connected. Waiting for headers...'
          updateUnified()

          ws.send(JSON.stringify([
            'REQ', 'headers',
            { kinds: [KIND], authors: [PUBKEY], '#d': ['latest'], '#n': ['btc'], limit: 1 }
          ]))
        }

        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data)
            if (msg[0] !== 'EVENT' || msg[2]?.kind !== KIND) return

            const event = msg[2]
            const tags = Object.fromEntries(event.tags)
            const tipHeight = parseInt(tags.tip, 10)
            if (tipHeight <= nostrTip) return

            const count = event.content.length / 160
            const startHeight = tipHeight - count + 1

            // Hash the tip header
            const tipHex = event.content.slice((count - 1) * 160, count * 160)
            const tipBytes = hexToBytes(tipHex)
            nostrTipHash = headerHash(tipBytes)
            nostrTip = tipHeight

            // Check linkage to current/archive
            const firstHex = event.content.slice(0, 160)
            const firstBytes = hexToBytes(firstHex)
            const firstPrev = toHex(getPrevHash(firstBytes))
            const linked = firstPrev === currentTipHash || firstPrev === archiveTipHash

            const ts = getTimestamp(tipBytes)
            const date = new Date(ts * 1000).toLocaleString()

            phase3.detail.textContent = 'Block ' + tipHeight.toLocaleString() + ' \u2014 ' + date + (linked ? ' \u2014 linked' : ' \u2014 gap')
            setBadge(phase3, '\u2713 Live', 'badge-live')

            // Update live stats with Nostr tip
            updateLiveStat(lsHeight, tipHeight.toLocaleString())
            updateLiveStat(lsDate, new Date(ts * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))

            window._btcNostr = { tipHeight: nostrTip, tipHash: nostrTipHash }
            updateUnified()
          } catch (err) {
            console.error('Nostr error:', err)
          }
        }

        ws.onclose = () => {
          relayStatus[url] = 'disconnected'
          updateUnified()
          setTimeout(() => {
            if (nostrSockets[url]) {
              const newWs = new WebSocket(url)
              newWs.onopen = ws.onopen
              newWs.onmessage = ws.onmessage
              newWs.onclose = ws.onclose
              newWs.onerror = ws.onerror
              nostrSockets[url] = newWs
              relayStatus[url] = 'connecting'
            }
          }, 5000)
        }

        ws.onerror = () => { relayStatus[url] = 'error'; updateUnified() }
      })
    }

    async function runAll() {
      btn.disabled = true
      btn.textContent = 'Running...'

      try {
        await initHasher()
        await runArchive()
        await runCurrent()
        if (chain === 'btc') {
          runNostr() // async, keeps running — mainnet only for now
        } else {
          setBadge(phase3, 'N/A', 'badge-pending')
          phase3.detail.textContent = 'Nostr live stream not available for ' + chain
        }

        btn.textContent = 'Re-verify'
        btn.disabled = false
      } catch (err) {
        phase1.detail.textContent = 'Error: ' + err.message
        setBadge(phase1, 'Error', 'badge-error')
        btn.textContent = 'Retry'
        btn.disabled = false
      }
    }

    btn.addEventListener('click', () => {
      // Clean up old sockets
      Object.values(nostrSockets).forEach(ws => ws.close())
      nostrSockets = {}
      relayStatus = {}
      htfuContainer.style.display = 'none'
      runAll()
    })
  }
}
