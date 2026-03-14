export default {
  label: 'Nostr Live',
  icon: '\u{1F4E1}',

  canHandle(subject, store) {
    const node = store.get(subject.value)
    const type = store.type(node)
    return type && type.includes('Action')
  },

  render(subject, store, container) {
    const RELAYS = [
      'wss://relay.damus.io',
      'wss://nos.lol',
      'wss://relay.nostr.net',
      'wss://relay.primal.net',
    ]
    const KIND = 33333
    const PUBKEY = 'cccccccc829b802b7bf52d43edf7cfe62ac89f332a318b6826ac8bd6e73660da'
    const HEADER_SIZE = 80

    const style = document.createElement('style')
    style.textContent = `
      .nostr-pane { font-family: Georgia, 'Times New Roman', serif; max-width: 720px; margin: 0 auto; padding: 1rem; }
      .nostr-title { font-size: 1.5rem; margin-bottom: 0.5rem; }
      .nostr-subtitle { color: #666; margin-bottom: 1.5rem; }
      .nostr-btn { background: #f7931a; color: #fff; border: none; padding: 0.5rem 1.25rem; border-radius: 4px; cursor: pointer; font-size: 0.9rem; font-family: inherit; }
      .nostr-btn:hover { background: #e8850f; }
      .nostr-btn:disabled { background: #ccc; cursor: not-allowed; }
      .nostr-relays { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 1rem 0; }
      .nostr-relay { font-family: monospace; font-size: 0.75rem; padding: 0.25rem 0.5rem; background: #f5f4f0; border-radius: 4px; display: flex; align-items: center; gap: 0.3rem; }
      .nostr-dot { width: 8px; height: 8px; border-radius: 50%; }
      .nostr-status { padding: 1rem; border-radius: 4px; margin: 1rem 0; font-size: 0.9rem; }
      .nostr-status.ok { background: rgba(45, 138, 78, 0.1); color: #2d8a4e; border: 1px solid rgba(45, 138, 78, 0.3); }
      .nostr-status.waiting { background: #f5f4f0; color: #888; }
      .nostr-status.err { background: rgba(192, 57, 43, 0.1); color: #c0392b; }
      .nostr-status.info { background: rgba(247, 147, 26, 0.08); color: #555; border: 1px solid rgba(247, 147, 26, 0.2); }
      .nostr-headers { margin: 1rem 0; }
      .nostr-header-row { display: grid; grid-template-columns: 90px 1fr auto; gap: 1rem; padding: 0.5rem 0; border-bottom: 1px solid #eee; font-size: 0.85rem; align-items: center; }
      .nostr-header-row:first-child { border-top: 1px solid #eee; }
      .nostr-height { font-weight: bold; color: #f7931a; }
      .nostr-hash { font-family: monospace; font-size: 0.7rem; color: #666; overflow: hidden; text-overflow: ellipsis; }
      .nostr-time { color: #888; font-size: 0.75rem; white-space: nowrap; }
      .nostr-link { font-size: 0.8rem; margin: 1rem 0; }
      .nostr-link.ok { color: #2d8a4e; }
      .nostr-link.err { color: #c0392b; }
      .nostr-link.gap { color: #f7931a; }
    `
    container.appendChild(style)

    const pane = document.createElement('div')
    pane.className = 'nostr-pane'
    container.appendChild(pane)

    const titleEl = document.createElement('div')
    titleEl.className = 'nostr-title'
    titleEl.textContent = 'Nostr Live Headers'
    pane.appendChild(titleEl)

    const subtitle = document.createElement('div')
    subtitle.className = 'nostr-subtitle'
    subtitle.textContent = 'Subscribe to NIP-333 (kind 33333) for real-time block headers from trusted publisher.'
    pane.appendChild(subtitle)

    const btn = document.createElement('button')
    btn.className = 'nostr-btn'
    btn.textContent = 'Connect'
    pane.appendChild(btn)

    const relaysEl = document.createElement('div')
    relaysEl.className = 'nostr-relays'
    pane.appendChild(relaysEl)

    const linkEl = document.createElement('div')
    linkEl.className = 'nostr-link'
    linkEl.style.display = 'none'
    pane.appendChild(linkEl)

    const statusEl = document.createElement('div')
    statusEl.className = 'nostr-status waiting'
    statusEl.style.display = 'none'
    pane.appendChild(statusEl)

    const headersEl = document.createElement('div')
    headersEl.className = 'nostr-headers'
    pane.appendChild(headersEl)

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
      const reversed = new Uint8Array(32)
      for (let i = 0; i < 32; i++) reversed[i] = slice[31 - i]
      return reversed
    }
    function getTimestamp(header) {
      const view = new DataView(header.buffer, header.byteOffset)
      return view.getUint32(68, true)
    }

    let relayStatus = {}
    let sockets = {}
    let currentTip = 0
    let connected = false
    let liveHeaders = []

    function updateRelays() {
      relaysEl.textContent = ''
      RELAYS.forEach(url => {
        const tag = document.createElement('div')
        tag.className = 'nostr-relay'
        const dot = document.createElement('div')
        dot.className = 'nostr-dot'
        const s = relayStatus[url] || 'disconnected'
        dot.style.background = s === 'connected' ? '#2d8a4e' : s === 'connecting' ? '#b8860b' : '#c0392b'
        tag.appendChild(dot)
        const text = document.createTextNode(url.replace('wss://', ''))
        tag.appendChild(text)
        relaysEl.appendChild(tag)
      })
    }

    function setStatus(text, cls) {
      statusEl.textContent = text
      statusEl.className = 'nostr-status ' + cls
      statusEl.style.display = 'block'
    }

    function formatTime(ts) {
      return new Date(ts * 1000).toLocaleString()
    }

    function timeAgo(ts) {
      const s = Math.floor(Date.now() / 1000) - ts
      if (s < 60) return s + 's ago'
      if (s < 3600) return Math.floor(s / 60) + 'm ago'
      return Math.floor(s / 3600) + 'h ago'
    }

    function renderHeaders() {
      headersEl.textContent = ''
      liveHeaders.forEach(h => {
        const row = document.createElement('div')
        row.className = 'nostr-header-row'

        const height = document.createElement('div')
        height.className = 'nostr-height'
        height.textContent = h.height.toLocaleString()
        row.appendChild(height)

        const hash = document.createElement('div')
        hash.className = 'nostr-hash'
        hash.textContent = h.hash
        row.appendChild(hash)

        const time = document.createElement('div')
        time.className = 'nostr-time'
        time.textContent = timeAgo(h.timestamp)
        row.appendChild(time)

        headersEl.appendChild(row)
      })
    }

    function verifyLinkage(headers) {
      // Check if first Nostr header links to known chain
      if (headers.length === 0) return

      const firstHeader = headers[headers.length - 1] // oldest (they're reversed)
      const firstPrevHash = firstHeader.prevHash

      // Check against archive
      const archive = window._btcVerified
      const current = window._btcCurrent

      let linkedTo = null

      if (current && current.tipHash) {
        if (firstPrevHash === current.tipHash || headers.some(h => h.prevHash === current.tipHash)) {
          linkedTo = 'current epoch (height ' + current.tipHeight + ')'
        }
      }

      if (!linkedTo && archive && archive.tipHash) {
        if (firstPrevHash === archive.tipHash || headers.some(h => h.prevHash === archive.tipHash)) {
          linkedTo = 'archive (height ' + archive.tipHeight + ')'
        }
      }

      linkEl.style.display = 'block'
      if (linkedTo) {
        linkEl.className = 'nostr-link ok'
        linkEl.textContent = '\u2713 Live headers link to ' + linkedTo
      } else if (!archive && !current) {
        linkEl.className = 'nostr-link gap'
        linkEl.textContent = '\u26A0 Run Archive and Current tabs first to verify linkage'
      } else {
        linkEl.className = 'nostr-link gap'
        linkEl.textContent = '\u26A0 Gap between stored headers and live stream (chain may have advanced)'
      }
    }

    async function connectToRelays() {
      await initHasher()
      btn.disabled = true
      btn.textContent = 'Connected'
      connected = true
      setStatus('Connecting to relays...', 'waiting')

      RELAYS.forEach(url => {
        relayStatus[url] = 'connecting'
        updateRelays()

        const ws = new WebSocket(url)
        sockets[url] = ws

        ws.onopen = () => {
          relayStatus[url] = 'connected'
          updateRelays()

          const connectedCount = Object.values(relayStatus).filter(s => s === 'connected').length
          setStatus('Connected to ' + connectedCount + '/' + RELAYS.length + ' relays. Waiting for headers...', 'info')

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
            const count = event.content.length / 160

            if (tipHeight <= currentTip) return
            currentTip = tipHeight

            const startHeight = tipHeight - count + 1
            const parsed = []

            for (let i = 0; i < count; i++) {
              const hex = event.content.slice(i * 160, (i + 1) * 160)
              const bytes = hexToBytes(hex)
              const hashBytes = hash256sync(bytes)
              const hashReversed = new Uint8Array(32)
              for (let k = 0; k < 32; k++) hashReversed[k] = hashBytes[31 - k]

              const prevHash = getPrevHash(bytes)
              const timestamp = getTimestamp(bytes)

              parsed.push({
                height: startHeight + i,
                hash: toHex(hashReversed),
                prevHash: toHex(prevHash),
                timestamp,
                raw: bytes
              })
            }

            // Verify internal linkage
            let internalOk = true
            for (let i = 1; i < parsed.length; i++) {
              if (parsed[i].prevHash !== parsed[i - 1].hash) {
                internalOk = false
                break
              }
            }

            parsed.reverse() // newest first
            liveHeaders = parsed

            setStatus(
              '\u2713 Live tip: block ' + tipHeight.toLocaleString() + ' \u2014 ' +
              count + ' headers, ' + (internalOk ? 'chain valid' : 'CHAIN ERROR') + ' \u2014 ' +
              formatTime(parsed[0].timestamp),
              internalOk ? 'ok' : 'err'
            )

            // Publish for other panes
            window._btcNostr = {
              headers: parsed,
              tipHeight,
              tipHash: parsed[0].hash
            }
            document.dispatchEvent(new CustomEvent('btc-nostr-update', { detail: window._btcNostr }))

            verifyLinkage(parsed)
            renderHeaders()

          } catch (err) {
            console.error('Nostr parse error:', err)
          }
        }

        ws.onclose = () => {
          relayStatus[url] = 'disconnected'
          updateRelays()
          // Reconnect
          if (connected) {
            setTimeout(() => {
              if (connected) {
                relayStatus[url] = 'connecting'
                updateRelays()
                sockets[url] = new WebSocket(url)
                sockets[url].onopen = ws.onopen
                sockets[url].onmessage = ws.onmessage
                sockets[url].onclose = ws.onclose
                sockets[url].onerror = ws.onerror
              }
            }, 5000)
          }
        }

        ws.onerror = () => {
          relayStatus[url] = 'error'
          updateRelays()
        }
      })
    }

    function disconnect() {
      connected = false
      Object.values(sockets).forEach(ws => ws.close())
      sockets = {}
      relayStatus = {}
      updateRelays()
      btn.disabled = false
      btn.textContent = 'Connect'
      setStatus('Disconnected', 'waiting')
    }

    btn.addEventListener('click', () => {
      if (connected) {
        disconnect()
      } else {
        connectToRelays()
      }
    })

    updateRelays()
  }
}
