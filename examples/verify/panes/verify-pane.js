export default {
  label: 'Verify',
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

    // State
    let verifying = false
    let verified = 0
    let totalHeaders = 0
    let chainErrors = []
    let powErrors = []
    let totalWork = 0n
    let maxLeadingZeros = 0
    let status = 'idle'

    // Approximate cost to reproduce: ~$0.10/kWh (electricity + amortized hardware)
    // at ~30 J/TH: 30 / 3,600,000 × $0.10 = $8.33e-7 per TH × 1e6 = $0.833 per EH
    const COST_PER_EH = 0.833

    // Build UI
    const style = document.createElement('style')
    style.textContent = `
      .verify-pane { font-family: Georgia, 'Times New Roman', serif; max-width: 720px; margin: 0 auto; padding: 1rem; }
      .verify-title { font-size: 1.5rem; margin-bottom: 0.5rem; }
      .verify-subtitle { color: #666; margin-bottom: 1.5rem; }
      .verify-source { font-family: monospace; font-size: 0.8rem; color: #888; word-break: break-all; margin-bottom: 1.5rem; }
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
    sourceEl.textContent = source
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

    // Basic stats row
    const stats = document.createElement('div')
    stats.className = 'verify-stats'
    progressSection.appendChild(stats)

    const statHeaders = createStat('0', 'Headers Verified')
    const statEpochs = createStat('0', 'Epochs')
    const statSize = createStat('0 MB', 'Downloaded')
    stats.appendChild(statHeaders)
    stats.appendChild(statEpochs)
    stats.appendChild(statSize)

    // Security / work stats
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
    const secWork = createSecurityItem('0', 'Total work (log\u2082)')
    const secHashes = createSecurityItem('0', 'Estimated hashes')
    const secCost = createSecurityItem('$0', 'Approx. cost to reproduce')
    const secZeros = createSecurityItem('0', 'Max leading zero bits')
    const secHeight = createSecurityItem('0', 'Block height')
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

    // Format large numbers
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

    // Compute work from bits field: 2^256 / target
    function workFromBits(headerBuf) {
      const view = new DataView(headerBuf.buffer, headerBuf.byteOffset)
      const bits = view.getUint32(72, true)
      const exponent = bits >> 24
      const mantissa = BigInt(bits & 0x007fffff)
      if (mantissa === 0n) return 0n
      const target = mantissa * (2n ** BigInt(8 * (exponent - 3)))
      if (target === 0n) return 0n
      return (2n ** 256n) / target
    }

    function updateSecurityDisplay() {
      const log2Work = log2BigInt(totalWork)
      updateSecurityValue(secWork, '2<sup>' + log2Work + '</sup> <span class="unit">hashes of work</span>')
      updateSecurityValue(secHashes, formatHashes(totalWork))

      // Cost: totalWork in EH × cost per EH
      const workInEH = totalWork / (10n ** 18n)
      const cost = Number(workInEH) * COST_PER_EH
      updateSecurityValue(secCost, formatDollars(cost))
      updateSecurityValue(secZeros, maxLeadingZeros + ' <span class="unit">bits (difficulty frontier)</span>')
    }

    // Double SHA-256 — WASM (fast, synchronous after init)
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

    // Verify PoW: hash <= target
    function verifyPoW(headerBuf, hashReversed) {
      const view = new DataView(headerBuf.buffer, headerBuf.byteOffset)
      const bits = view.getUint32(72, true)
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

    async function download() {
      status = 'downloading'
      progressSection.style.display = 'block'
      log.style.display = 'block'
      btn.disabled = true
      btn.textContent = 'Downloading...'
      progressLabel.textContent = 'Downloading headers...'

      addLog('Fetching ' + source, 'ok')

      const response = await fetch(source)
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
      addLog('Verifying chain linkage and proof-of-work...', 'ok')

      let prevHash = null
      verified = 0
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

          // Chain linkage
          if (prevHash) {
            const headerPrevHash = getPrevHash(header)
            let mismatch = false
            for (let k = 0; k < 32; k++) {
              if (prevHash[k] !== headerPrevHash[k]) { mismatch = true; break }
            }
            if (mismatch) {
              addLog('Chain break at height ' + height, 'err')
              chainErrors.push(height)
            }
          }

          // Leading zeros
          const zeros = countLeadingZeroBits(hashReversed)
          if (zeros > maxLeadingZeros) maxLeadingZeros = zeros

          // Accumulate work
          totalWork += workFromBits(header)

          // PoW verification (sample every 100 + first 1000)
          if (height < 1000 || height % 100 === 0) {
            if (!verifyPoW(header, hashReversed)) {
              addLog('PoW failed at height ' + height, 'err')
              powErrors.push(height)
            }
          }

          prevHash = hashReversed
          verified++
        }

        // Update UI
        const pct = (verified / totalHeaders * 100).toFixed(1)
        barInner.style.width = pct + '%'
        progressLabel.textContent = 'Verifying... ' + verified.toLocaleString() + ' / ' + totalHeaders.toLocaleString() + ' (' + pct + '%)'
        updateStat(statHeaders, verified.toLocaleString())
        updateStat(statEpochs, Math.floor(verified / EPOCH_SIZE).toString())

        // Update security stats + date
        updateSecurityDisplay()
        updateSecurityValue(secHeight, (verified - 1).toLocaleString())
        const lastHeader = data.slice((verified - 1) * HEADER_SIZE, verified * HEADER_SIZE)
        const lastView = new DataView(lastHeader.buffer, lastHeader.byteOffset)
        const lastTime = lastView.getUint32(68, true)
        const dateStr = new Date(lastTime * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
        updateSecurityValue(secDate, dateStr)

        // Log epoch milestones
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

      addLog('---', '')
      addLog('Tip hash: ' + hashHex, 'ok')
      addLog('Total work: 2^' + log2W + ' hashes', 'ok')
      addLog('Cost to reproduce: ' + formatDollars(cost), 'ok')
      addLog('Max difficulty: ' + maxLeadingZeros + ' leading zero bits', 'ok')
      addLog('Verified ' + verified.toLocaleString() + ' headers in ' + elapsed + 's', 'ok')
      addLog('Chain errors: ' + chainErrors.length, chainErrors.length ? 'err' : 'ok')
      addLog('PoW errors: ' + powErrors.length, powErrors.length ? 'err' : 'ok')

      status = 'done'
      btn.disabled = false
      btn.textContent = 'Verify Again'

      resultEl.style.display = 'block'
      if (chainErrors.length === 0 && powErrors.length === 0) {
        resultEl.className = 'verify-result pass'
        resultEl.textContent = '\u2713 Chain verified: ' + verified.toLocaleString() + ' headers, 2^' + log2W + ' work, ' + formatDollars(cost) + ' to attack, ' + elapsed + 's'
      } else {
        resultEl.className = 'verify-result fail'
        resultEl.textContent = '\u2717 Verification failed: ' + chainErrors.length + ' chain errors, ' + powErrors.length + ' PoW errors'
      }
    }

    btn.addEventListener('click', async () => {
      if (verifying) return
      verifying = true
      chainErrors = []
      powErrors = []
      totalWork = 0n
      maxLeadingZeros = 0
      resultEl.style.display = 'none'
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
