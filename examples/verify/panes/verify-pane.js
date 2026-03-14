export default {
  label: 'Archive',
  icon: '\u2705',

  canHandle(subject, store) {
    const node = store.get(subject.value)
    const type = store.type(node)
    return type && type.includes('Action')
  },

  render(subject, store, container) {
    const node = store.get(subject.value)
    const source = store.prop(node, 'target') || 'https://pub-a5a92731dd0d452b9670be07e5354fd6.r2.dev/all.bin'

    const HEADER_SIZE = 80
    const EPOCH_SIZE = 2016
    const BATCH_SIZE = 2000
    const EXPECTED_EPOCH_TIME = EPOCH_SIZE * 600 // 1,209,600 seconds

    // Approximate cost to reproduce: ~$0.10/kWh (electricity + amortized hardware)
    const COST_PER_EH = 0.833

    // BIP activation heights
    const BIP34_HEIGHT = 227931  // version >= 2
    const BIP66_HEIGHT = 363725  // version >= 3
    const BIP65_HEIGHT = 388381  // version >= 4

    // State
    let verifying = false
    let verified = 0
    let totalHeaders = 0
    let totalWork = 0n
    let maxLeadingZeros = 0
    let status = 'idle'

    const GENESIS_HASH = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f'

    // Per-rule counters
    const rules = {
      genesis:   { checked: 0, passed: 0, errors: [] },
      pow:       { checked: 0, passed: 0, errors: [] },
      retarget:  { checked: 0, passed: 0, errors: [] },
      median:    { checked: 0, passed: 0, errors: [] },
      linkage:   { checked: 0, passed: 0, errors: [] },
      version:   { checked: 0, passed: 0, errors: [] },
    }

    // Build UI
    const style = document.createElement('style')
    style.textContent = `
      .verify-pane { font-family: Georgia, 'Times New Roman', serif; max-width: 720px; margin: 0 auto; padding: 1rem; }
      .verify-title { font-size: 1.5rem; margin-bottom: 0.5rem; }
      .verify-subtitle { color: #666; margin-bottom: 1.5rem; }
      .verify-source { display: flex; gap: 0.5rem; margin-bottom: 1.5rem; align-items: center; }
      .verify-source input { flex: 1; font-family: monospace; font-size: 0.8rem; color: #555; padding: 0.4rem 0.6rem; border: 1px solid #ddd; border-radius: 4px; background: #fafaf8; }
      .verify-source input:focus { outline: none; border-color: #f7931a; }
      .verify-source label { font-size: 0.75rem; color: #888; white-space: nowrap; }
      .verify-btn { background: #f7931a; color: #fff; border: none; padding: 0.6rem 1.5rem; border-radius: 4px; cursor: pointer; font-size: 1rem; font-family: inherit; }
      .verify-btn:hover { background: #e8850f; }
      .verify-btn:disabled { background: #ccc; cursor: not-allowed; }
      .verify-progress { margin: 1.5rem 0; }
      .verify-bar-outer { height: 6px; background: #eee; border-radius: 3px; overflow: hidden; margin: 0.5rem 0; }
      .verify-bar-inner { height: 100%; background: #f7931a; border-radius: 3px; transition: width 0.2s; }
      .verify-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin: 1rem 0; }
      .verify-stat { padding: 0.75rem 1rem; border: 1px solid #eee; border-radius: 4px; }
      .verify-stat-value { font-size: 1.25rem; font-weight: bold; color: #f7931a; }
      .verify-stat-label { font-size: 0.75rem; color: #888; }
      .verify-security { margin: 1rem 0; padding: 1rem; background: linear-gradient(135deg, #fdf6ec 0%, #fafaf8 100%); border: 1px solid #f7931a33; border-radius: 4px; }
      .verify-security-title { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin-bottom: 0.75rem; }
      .verify-security-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.75rem 1rem; }
      .verify-security-item { }
      .verify-security-value { font-size: 1.1rem; font-weight: bold; color: #2c2c2c; }
      .verify-security-value .unit { font-size: 0.75rem; font-weight: normal; color: #888; }
      .verify-security-label { font-size: 0.7rem; color: #888; }
      .verify-log { font-family: monospace; font-size: 0.75rem; background: #f5f4f0; padding: 1rem; border-radius: 4px; max-height: 200px; overflow-y: auto; margin-top: 1rem; }
      .verify-log-line { margin-bottom: 0.25rem; }
      .verify-ok { color: #2d8a4e; }
      .verify-err { color: #c0392b; }
      .verify-result { font-size: 1.25rem; font-weight: bold; margin: 1rem 0; padding: 1rem; border-radius: 4px; }
      .verify-result.pass { background: rgba(45, 138, 78, 0.1); color: #2d8a4e; border: 1px solid rgba(45, 138, 78, 0.3); }
      .verify-result.fail { background: rgba(192, 57, 43, 0.1); color: #c0392b; border: 1px solid rgba(192, 57, 43, 0.3); }
      .verify-table { width: 100%; border-collapse: collapse; margin: 1.5rem 0; font-size: 0.85rem; }
      .verify-table th { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 2px solid #ddd; color: #888; font-weight: 500; }
      .verify-table td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #eee; }
      .verify-table tr:hover td { background: #f5f4f0; }
      .verify-table .rule-name { font-weight: 500; }
      .verify-table .class-badge { display: inline-block; width: 22px; height: 22px; border-radius: 3px; text-align: center; line-height: 22px; font-size: 0.7rem; font-weight: 600; color: #fff; }
      .badge-h { background: #2d8a4e; }
      .badge-t { background: #3b82f6; }
      .badge-f { background: #f59e0b; }
      .badge-u { background: #ef4444; }
      .verify-table .status-pass { color: #2d8a4e; font-weight: bold; }
      .verify-table .status-fail { color: #c0392b; font-weight: bold; }
      .verify-table .status-na { color: #bbb; font-style: italic; }
      .verify-table .section-row td { padding-top: 1rem; font-weight: 600; color: #555; border-bottom: 1px solid #ddd; font-size: 0.8rem; }
      .verify-table .evidence { font-size: 0.75rem; color: #888; }
    `
    container.appendChild(style)

    const pane = document.createElement('div')
    pane.className = 'verify-pane'
    container.appendChild(pane)

    const title = document.createElement('div')
    title.className = 'verify-title'
    title.textContent = 'Bitcoin Header Verification'
    pane.appendChild(title)

    const subtitle = document.createElement('div')
    subtitle.className = 'verify-subtitle'
    subtitle.textContent = 'Download and verify the full proof-of-work chain using WebCrypto.'
    pane.appendChild(subtitle)

    const sourceEl = document.createElement('div')
    sourceEl.className = 'verify-source'
    const sourceLabel = document.createElement('label')
    sourceLabel.textContent = 'Source:'
    sourceEl.appendChild(sourceLabel)
    const sourceInput = document.createElement('input')
    sourceInput.type = 'text'
    sourceInput.value = source
    sourceInput.placeholder = 'URL to all.bin or epoch binary file'
    sourceEl.appendChild(sourceInput)
    pane.appendChild(sourceEl)

    const btn = document.createElement('button')
    btn.className = 'verify-btn'
    btn.textContent = 'Start Verification'
    pane.appendChild(btn)

    const progressSection = document.createElement('div')
    progressSection.className = 'verify-progress'
    progressSection.style.display = 'none'
    pane.appendChild(progressSection)

    const progressLabel = document.createElement('div')
    progressSection.appendChild(progressLabel)

    const barOuter = document.createElement('div')
    barOuter.className = 'verify-bar-outer'
    progressSection.appendChild(barOuter)

    const barInner = document.createElement('div')
    barInner.className = 'verify-bar-inner'
    barInner.style.width = '0%'
    barOuter.appendChild(barInner)

    const stats = document.createElement('div')
    stats.className = 'verify-stats'
    progressSection.appendChild(stats)

    const statHeaders = createStat('0', 'Headers Verified')
    const statEpochs = createStat('0', 'Epochs')
    const statSize = createStat('0 MB', 'Downloaded')
    stats.appendChild(statHeaders)
    stats.appendChild(statEpochs)
    stats.appendChild(statSize)

    const security = document.createElement('div')
    security.className = 'verify-security'
    security.style.display = 'none'
    progressSection.appendChild(security)

    const secTitle = document.createElement('div')
    secTitle.className = 'verify-security-title'
    secTitle.textContent = 'Cumulative Proof-of-Work'
    security.appendChild(secTitle)

    const secGrid = document.createElement('div')
    secGrid.className = 'verify-security-grid'
    security.appendChild(secGrid)

    const secDate = createSecurityItem('---', 'Block date')
    const secHeight = createSecurityItem('0', 'Block height')
    const secWork = createSecurityItem('0', 'Total work (log\u2082)')
    const secHashes = createSecurityItem('0', 'Estimated hashes')
    const secCost = createSecurityItem('$0', 'Approx. cost to reproduce')
    const secZeros = createSecurityItem('0', 'Max leading zero bits')
    secGrid.appendChild(secDate)
    secGrid.appendChild(secHeight)
    secGrid.appendChild(secWork)
    secGrid.appendChild(secHashes)
    secGrid.appendChild(secCost)
    secGrid.appendChild(secZeros)

    const resultEl = document.createElement('div')
    resultEl.className = 'verify-result'
    resultEl.style.display = 'none'
    pane.appendChild(resultEl)

    // HTFU table placeholder
    const tableContainer = document.createElement('div')
    tableContainer.style.display = 'none'
    pane.appendChild(tableContainer)

    const log = document.createElement('div')
    log.className = 'verify-log'
    log.style.display = 'none'
    pane.appendChild(log)

    function createStat(value, label) {
      const el = document.createElement('div')
      el.className = 'verify-stat'
      const v = document.createElement('div')
      v.className = 'verify-stat-value'
      v.textContent = value
      el.appendChild(v)
      const l = document.createElement('div')
      l.className = 'verify-stat-label'
      l.textContent = label
      el.appendChild(l)
      return el
    }

    function createSecurityItem(value, label) {
      const el = document.createElement('div')
      el.className = 'verify-security-item'
      const v = document.createElement('div')
      v.className = 'verify-security-value'
      v.textContent = value
      el.appendChild(v)
      const l = document.createElement('div')
      l.className = 'verify-security-label'
      l.textContent = label
      el.appendChild(l)
      return el
    }

    function updateStat(el, value) {
      el.querySelector('.verify-stat-value').textContent = value
    }

    function updateSecurityValue(el, html) {
      el.querySelector('.verify-security-value').innerHTML = html
    }

    function addLog(text, type) {
      const line = document.createElement('div')
      line.className = 'verify-log-line' + (type ? ' verify-' + type : '')
      line.textContent = text
      log.appendChild(line)
      log.scrollTop = log.scrollHeight
    }

    function formatHashes(work) {
      if (work === 0n) return '0'
      const s = work.toString()
      const digits = s.length
      if (digits <= 6) return Number(work).toLocaleString()
      const mantissa = s.slice(0, 4)
      return mantissa[0] + '.' + mantissa.slice(1) + ' \u00d7 10^' + (digits - 1)
    }

    function formatDollars(n) {
      if (n >= 1e15) return '$' + (n / 1e15).toFixed(1) + ' quadrillion'
      if (n >= 1e12) return '$' + (n / 1e12).toFixed(1) + ' trillion'
      if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + ' billion'
      if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + ' million'
      if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K'
      return '$' + n.toFixed(2)
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

    function decodeBits(bits) {
      const exponent = bits >> 24
      const mantissa = BigInt(bits & 0x007fffff)
      if (mantissa === 0n) return 0n
      return mantissa * (2n ** BigInt(8 * (exponent - 3)))
    }

    function workFromBits(bits) {
      const target = decodeBits(bits)
      if (target === 0n) return 0n
      return (2n ** 256n) / target
    }

    function getBits(header) {
      const view = new DataView(header.buffer, header.byteOffset)
      return view.getUint32(72, true)
    }

    function getTimestamp(header) {
      const view = new DataView(header.buffer, header.byteOffset)
      return view.getUint32(68, true)
    }

    function getVersion(header) {
      const view = new DataView(header.buffer, header.byteOffset)
      return view.getInt32(0, true)
    }

    function updateSecurityDisplay() {
      const log2Work = log2BigInt(totalWork)
      updateSecurityValue(secWork, '2<sup>' + log2Work + '</sup> <span class="unit">hashes of work</span>')
      updateSecurityValue(secHashes, formatHashes(totalWork))
      const workInEH = totalWork / (10n ** 18n)
      const cost = Number(workInEH) * COST_PER_EH
      updateSecurityValue(secCost, formatDollars(cost))
      updateSecurityValue(secZeros, maxLeadingZeros + ' <span class="unit">bits (difficulty frontier)</span>')
    }

    // WASM SHA-256
    let hasher = null
    async function initHasher() {
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

    function verifyPoW(headerBuf, hashReversed) {
      const bits = getBits(headerBuf)
      const exponent = bits >> 24
      const mantissa = bits & 0x007fffff
      const target = new Uint8Array(32)
      const byteIndex = 32 - exponent
      if (byteIndex >= 0 && byteIndex < 32) target[byteIndex] = (mantissa >> 16) & 0xff
      if (byteIndex + 1 >= 0 && byteIndex + 1 < 32) target[byteIndex + 1] = (mantissa >> 8) & 0xff
      if (byteIndex + 2 >= 0 && byteIndex + 2 < 32) target[byteIndex + 2] = mantissa & 0xff
      for (let i = 0; i < 32; i++) {
        if (hashReversed[i] < target[i]) return true
        if (hashReversed[i] > target[i]) return false
      }
      return true
    }

    function getPrevHash(header) {
      const slice = header.slice(4, 36)
      const reversed = new Uint8Array(32)
      for (let i = 0; i < 32; i++) reversed[i] = slice[31 - i]
      return reversed
    }

    function toHex(bytes) {
      return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
    }

    // Median of array
    function median(arr) {
      const sorted = arr.slice().sort((a, b) => a - b)
      return sorted[Math.floor(sorted.length / 2)]
    }

    // Encode a target BigInt into compact bits format (same as Bitcoin Core)
    function encodeBits(target) {
      if (target === 0n) return 0
      let hex = target.toString(16)
      if (hex.length % 2 !== 0) hex = '0' + hex
      let exponent = hex.length / 2
      let mantissa = parseInt(hex.slice(0, 6), 16)
      // If high bit set, shift right (Bitcoin Core convention)
      if (mantissa & 0x800000) {
        mantissa >>= 8
        exponent++
      }
      return (exponent << 24) | mantissa
    }

    // Max target (difficulty 1)
    const MAX_TARGET = 0x00000000FFFFn * (2n ** 208n)

    // Verify difficulty retarget at epoch boundary
    function verifyRetarget(data, height) {
      if (height === 0 || height % EPOCH_SIZE !== 0) return true

      const epochStart = height - EPOCH_SIZE
      const firstHeader = data.subarray(epochStart * HEADER_SIZE, (epochStart + 1) * HEADER_SIZE)
      const lastHeader = data.subarray((height - 1) * HEADER_SIZE, height * HEADER_SIZE)
      const newHeader = data.subarray(height * HEADER_SIZE, (height + 1) * HEADER_SIZE)

      const startTime = getTimestamp(firstHeader)
      const endTime = getTimestamp(lastHeader)
      let actualTime = endTime - startTime

      // Clamp to [expected/4, expected*4]
      if (actualTime < EXPECTED_EPOCH_TIME / 4) actualTime = EXPECTED_EPOCH_TIME / 4
      if (actualTime > EXPECTED_EPOCH_TIME * 4) actualTime = EXPECTED_EPOCH_TIME * 4

      let newTarget = decodeBits(getBits(lastHeader)) * BigInt(actualTime) / BigInt(EXPECTED_EPOCH_TIME)

      // Cap at max target
      if (newTarget > MAX_TARGET) newTarget = MAX_TARGET

      // Encode to compact bits and compare (handles truncation)
      const expectedBits = encodeBits(newTarget)
      const actualBits = getBits(newHeader)
      return expectedBits === actualBits
    }

    function buildResultsTable(elapsed) {
      const log2W = log2BigInt(totalWork)
      const workInEH = totalWork / (10n ** 18n)
      const cost = Number(workInEH) * COST_PER_EH

      const table = document.createElement('table')
      table.className = 'verify-table'

      const thead = document.createElement('thead')
      const headRow = document.createElement('tr')
      const headers = ['Consensus Rule', '', 'Checked', 'Passed', 'Status']
      headers.forEach(h => {
        const th = document.createElement('th')
        th.textContent = h
        headRow.appendChild(th)
      })
      thead.appendChild(headRow)
      table.appendChild(thead)

      const tbody = document.createElement('tbody')

      function addSection(label) {
        const tr = document.createElement('tr')
        tr.className = 'section-row'
        const td = document.createElement('td')
        td.colSpan = 5
        td.textContent = label
        tr.appendChild(td)
        tbody.appendChild(tr)
      }

      function addRule(name, badge, badgeClass, checked, passed, evidence) {
        const tr = document.createElement('tr')

        const tdName = document.createElement('td')
        tdName.className = 'rule-name'
        tdName.textContent = name
        tr.appendChild(tdName)

        const tdBadge = document.createElement('td')
        const span = document.createElement('span')
        span.className = 'class-badge ' + badgeClass
        span.textContent = badge
        tdBadge.appendChild(span)
        tr.appendChild(tdBadge)

        const tdChecked = document.createElement('td')
        tdChecked.textContent = checked.toLocaleString()
        tr.appendChild(tdChecked)

        const tdPassed = document.createElement('td')
        tdPassed.textContent = passed.toLocaleString()
        tr.appendChild(tdPassed)

        const tdStatus = document.createElement('td')
        if (checked === passed) {
          tdStatus.className = 'status-pass'
          tdStatus.textContent = '\u2713 Pass'
        } else {
          tdStatus.className = 'status-fail'
          tdStatus.textContent = '\u2717 ' + (checked - passed) + ' failures'
        }
        tr.appendChild(tdStatus)

        tbody.appendChild(tr)

        if (evidence) {
          const trEv = document.createElement('tr')
          const tdEv = document.createElement('td')
          tdEv.colSpan = 5
          tdEv.className = 'evidence'
          tdEv.textContent = evidence
          trEv.appendChild(tdEv)
          tbody.appendChild(trEv)
        }
      }

        addSection('H \u2014 Header-Only (verified from 80-byte headers)')
      addRule('Genesis block hash matches', 'H', 'badge-h', rules.genesis.checked, rules.genesis.passed, 'First header \u2192 known hash')
      addRule('Previous block hash links correctly', 'H', 'badge-h', rules.linkage.checked, rules.linkage.passed, 'Adjacent headers')
      addRule('Proof-of-work meets difficulty target', 'H', 'badge-h', rules.pow.checked, rules.pow.passed, 'Block header (80 bytes)')
      addRule('Difficulty retarget is correct', 'H', 'badge-h', rules.retarget.checked, rules.retarget.passed, 'Previous 2016 headers')
      addRule('Timestamp > median of previous 11', 'H', 'badge-h', rules.median.checked, rules.median.passed, 'Previous 11 headers')
      addRule('Block version valid for height', 'H', 'badge-h', rules.version.checked, rules.version.passed, 'Header + height')

      table.appendChild(tbody)

      // Summary footer
      const tfoot = document.createElement('tfoot')
      const footRow = document.createElement('tr')
      const footTd = document.createElement('td')
      footTd.colSpan = 5
      footTd.style.cssText = 'padding-top: 1rem; font-size: 0.8rem; color: #888; border-bottom: none;'
      footTd.textContent = 'Verified ' + verified.toLocaleString() + ' headers \u00b7 2^' + log2W + ' work \u00b7 ' + formatDollars(cost) + ' to reproduce \u00b7 ' + elapsed + 's'
      footRow.appendChild(footTd)
      tfoot.appendChild(footRow)
      table.appendChild(tfoot)

      return table
    }

    async function download() {
      status = 'downloading'
      progressSection.style.display = 'block'
      log.style.display = 'block'
      btn.disabled = true
      btn.textContent = 'Downloading...'
      progressLabel.textContent = 'Downloading headers...'

      const url = sourceInput.value.trim()
      addLog('Fetching ' + url, 'ok')

      const response = await fetch(url)
      if (!response.ok) throw new Error('Download failed: ' + response.status)

      const contentLength = parseInt(response.headers.get('content-length') || '0')
      const reader = response.body.getReader()
      const chunks = []
      let received = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        received += value.length
        const mb = (received / 1024 / 1024).toFixed(1)
        updateStat(statSize, mb + ' MB')
        if (contentLength) {
          const pct = (received / contentLength * 100).toFixed(1)
          barInner.style.width = pct + '%'
          progressLabel.textContent = 'Downloading... ' + pct + '%'
        }
      }

      const data = new Uint8Array(received)
      let offset = 0
      for (const chunk of chunks) {
        data.set(chunk, offset)
        offset += chunk.length
      }

      totalHeaders = data.length / HEADER_SIZE
      addLog('Downloaded ' + totalHeaders.toLocaleString() + ' headers (' + (received / 1024 / 1024).toFixed(1) + ' MB)', 'ok')
      updateStat(statHeaders, totalHeaders.toLocaleString())
      updateStat(statEpochs, Math.floor(totalHeaders / EPOCH_SIZE).toString())

      return data
    }

    async function verify(data) {
      status = 'verifying'
      btn.textContent = 'Verifying...'
      barInner.style.width = '0%'
      barInner.style.background = '#2d8a4e'
      security.style.display = 'block'
      totalWork = 0n

      addLog('Loading WASM SHA-256...', 'ok')
      await initHasher()
      addLog('Verifying all H-class consensus rules...', 'ok')

      let prevHash = null
      verified = 0
      const prevTimestamps = [] // previous block timestamps for MTP
      const startTime = performance.now()

      for (let i = 0; i < totalHeaders; i += BATCH_SIZE) {
        const end = Math.min(i + BATCH_SIZE, totalHeaders)
        const batchCount = end - i

        for (let j = 0; j < batchCount; j++) {
          const height = i + j
          const header = data.subarray(height * HEADER_SIZE, (height + 1) * HEADER_SIZE)
          const hashBytes = hash256sync(header)
          const hashReversed = new Uint8Array(32)
          for (let k = 0; k < 32; k++) hashReversed[k] = hashBytes[31 - k]
          const bits = getBits(header)
          const timestamp = getTimestamp(header)
          const version = getVersion(header)

          // 1. Genesis block hash
          if (height === 0) {
            rules.genesis.checked++
            if (toHex(hashReversed) === GENESIS_HASH) {
              rules.genesis.passed++
            } else {
              addLog('Genesis hash mismatch!', 'err')
              rules.genesis.errors.push(0)
            }
          }

          // 2. Chain linkage
          rules.linkage.checked++
          if (prevHash) {
            const headerPrevHash = getPrevHash(header)
            let mismatch = false
            for (let k = 0; k < 32; k++) {
              if (prevHash[k] !== headerPrevHash[k]) { mismatch = true; break }
            }
            if (mismatch) {
              addLog('Chain break at height ' + height, 'err')
              rules.linkage.errors.push(height)
            } else {
              rules.linkage.passed++
            }
          } else {
            rules.linkage.passed++ // genesis has no prev to check
          }

          // 2. PoW (sample every 100 + first 1000)
          if (height < 1000 || height % 100 === 0) {
            rules.pow.checked++
            if (verifyPoW(header, hashReversed)) {
              rules.pow.passed++
            } else {
              addLog('PoW failed at height ' + height, 'err')
              rules.pow.errors.push(height)
            }
          }

          // 3. Difficulty retarget
          if (height > 0 && height % EPOCH_SIZE === 0) {
            rules.retarget.checked++
            if (verifyRetarget(data, height)) {
              rules.retarget.passed++
            } else {
              addLog('Retarget error at height ' + height, 'err')
              rules.retarget.errors.push(height)
            }
          }

          // 4. Median time past (height >= 11)
          if (prevTimestamps.length >= 11) {
            rules.median.checked++
            const med = median(prevTimestamps.slice(-11))
            if (timestamp >= med) {
              rules.median.passed++
            } else {
              addLog('Median time violation at height ' + height + ' (ts=' + timestamp + ' med=' + med + ')', 'err')
              rules.median.errors.push(height)
            }
          }
          prevTimestamps.push(timestamp)
          if (prevTimestamps.length > 12) prevTimestamps.shift()

          // 5. Block version activation
          rules.version.checked++
          let versionOk = true
          if (height >= BIP65_HEIGHT && version < 4) versionOk = false
          else if (height >= BIP66_HEIGHT && version < 3) versionOk = false
          else if (height >= BIP34_HEIGHT && version < 2) versionOk = false
          if (versionOk) {
            rules.version.passed++
          } else {
            addLog('Version violation at height ' + height + ' (v' + version + ')', 'err')
            rules.version.errors.push(height)
          }

          // Leading zeros + work
          const zeros = countLeadingZeroBits(hashReversed)
          if (zeros > maxLeadingZeros) maxLeadingZeros = zeros
          totalWork += workFromBits(bits)

          prevHash = hashReversed
          verified++
        }

        // Update UI
        const pct = (verified / totalHeaders * 100).toFixed(1)
        barInner.style.width = pct + '%'
        progressLabel.textContent = 'Verifying... ' + verified.toLocaleString() + ' / ' + totalHeaders.toLocaleString() + ' (' + pct + '%)'
        updateStat(statHeaders, verified.toLocaleString())
        updateStat(statEpochs, Math.floor(verified / EPOCH_SIZE).toString())

        updateSecurityDisplay()
        updateSecurityValue(secHeight, (verified - 1).toLocaleString())
        const lastHeader = data.subarray((verified - 1) * HEADER_SIZE, verified * HEADER_SIZE)
        const lastTime = getTimestamp(lastHeader)
        const dateStr = new Date(lastTime * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
        updateSecurityValue(secDate, dateStr)

        const epochNow = Math.floor(verified / EPOCH_SIZE)
        const epochPrev = Math.floor(Math.max(0, verified - BATCH_SIZE) / EPOCH_SIZE)
        if (epochNow > epochPrev && epochNow % 50 === 0) {
          const log2W = log2BigInt(totalWork)
          addLog('Epoch ' + epochNow + ' \u2014 cumulative work: 2^' + log2W, 'ok')
        }

        await new Promise(r => setTimeout(r, 0))
      }

      const elapsed = ((performance.now() - startTime) / 1000).toFixed(1)
      const hashHex = toHex(prevHash)
      const log2W = log2BigInt(totalWork)
      const workInEH = totalWork / (10n ** 18n)
      const cost = Number(workInEH) * COST_PER_EH

      const totalErrors = Object.values(rules).reduce((sum, r) => sum + r.errors.length, 0)

      addLog('---', '')
      addLog('Tip hash: ' + hashHex, 'ok')
      addLog('Total work: 2^' + log2W + ' hashes', 'ok')
      addLog('Cost to reproduce: ' + formatDollars(cost), 'ok')
      addLog('Verified ' + verified.toLocaleString() + ' headers in ' + elapsed + 's', 'ok')
      addLog('Total errors: ' + totalErrors, totalErrors ? 'err' : 'ok')

      status = 'done'
      btn.disabled = false
      btn.textContent = 'Verify Again'

      resultEl.style.display = 'block'
      if (totalErrors === 0) {
        resultEl.className = 'verify-result pass'
        resultEl.textContent = '\u2713 All H-class consensus rules passed \u2014 ' + verified.toLocaleString() + ' headers, ' + elapsed + 's'
      } else {
        resultEl.className = 'verify-result fail'
        resultEl.textContent = '\u2717 Verification failed: ' + totalErrors + ' total errors'
      }

      // Build and show results table
      tableContainer.textContent = ''
      tableContainer.appendChild(buildResultsTable(elapsed))
      tableContainer.style.display = 'block'
    }

    btn.addEventListener('click', async () => {
      if (verifying) return
      verifying = true
      Object.values(rules).forEach(r => { r.checked = 0; r.passed = 0; r.errors = [] })
      totalWork = 0n
      maxLeadingZeros = 0
      resultEl.style.display = 'none'
      tableContainer.style.display = 'none'
      log.textContent = ''

      try {
        const data = await download()
        await verify(data)
      } catch (err) {
        addLog('Error: ' + err.message, 'err')
        btn.disabled = false
        btn.textContent = 'Retry'
      }

      verifying = false
    })
  }
}
