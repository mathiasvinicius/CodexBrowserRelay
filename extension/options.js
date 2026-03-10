const BRAND = 'Codex Browser Relay'
const DEFAULT_PORT = 18793

function clampPort(value) {
  const n = Number.parseInt(String(value || ''), 10)
  if (!Number.isFinite(n)) return DEFAULT_PORT
  if (n <= 0 || n > 65535) return DEFAULT_PORT
  return n
}

function updateRelayUrl(port) {
  const el = document.getElementById('relay-url')
  if (!el) return
  el.textContent = `http://127.0.0.1:${port}/`
}

function setStatus(kind, message) {
  const status = document.getElementById('status')
  if (!status) return
  status.dataset.kind = kind || ''
  status.textContent = message || ''
}

function setDiagnostic(message) {
  const el = document.getElementById('diagnostic')
  if (!el) return
  el.textContent = message || 'No recent extension errors recorded.'
}

async function checkRelayReachable(port) {
  const url = `http://127.0.0.1:${port}/`
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 900)
  try {
    const res = await fetch(url, { method: 'HEAD', signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    setStatus('ok', `Relay reachable at ${url}`)
  } catch {
    setStatus(
      'error',
      `Relay not reachable at ${url}. Start the Codex-compatible browser relay on this machine, then click the toolbar button again.`,
    )
  } finally {
    clearTimeout(t)
  }
}

async function loadDiagnostics(port) {
  const stored = await chrome.storage.local.get(['lastErrorMessage', 'lastErrorAt', 'lastErrorContext'])
  const message = stored.lastErrorMessage
  const at = stored.lastErrorAt
  const url = stored.lastErrorContext?.url

  if (message) {
    const parts = [message]
    if (url) parts.push(`URL: ${url}`)
    if (at) parts.push(`At: ${at}`)
    setDiagnostic(parts.join(' | '))
  } else {
    setDiagnostic('No recent extension errors recorded.')
  }

  try {
    const res = await fetch(`http://127.0.0.1:${port}/extension/status`, { method: 'GET' })
    const data = await res.json()
    const relayInfo = document.getElementById('relay-connection')
    if (relayInfo) {
      relayInfo.textContent = data.connected
        ? `Relay sees the extension as connected. Attached targets: ${data.targets ?? 0}.`
        : 'Relay is reachable, but the extension is not attached to it yet.'
    }
  } catch {
    const relayInfo = document.getElementById('relay-connection')
    if (relayInfo) relayInfo.textContent = 'Relay diagnostics unavailable.'
  }
}

async function load() {
  const stored = await chrome.storage.local.get(['relayPort'])
  const port = clampPort(stored.relayPort)
  document.getElementById('port').value = String(port)
  updateRelayUrl(port)
  document.getElementById('brand').textContent = BRAND
  await checkRelayReachable(port)
  await loadDiagnostics(port)
}

async function save() {
  const input = document.getElementById('port')
  const port = clampPort(input.value)
  await chrome.storage.local.set({ relayPort: port })
  input.value = String(port)
  updateRelayUrl(port)
  await checkRelayReachable(port)
  await loadDiagnostics(port)
}

document.getElementById('save').addEventListener('click', () => void save())
void load()
