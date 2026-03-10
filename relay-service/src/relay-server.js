import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import WebSocket, { WebSocketServer } from 'ws'

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 18793
const DEFAULT_STATE_FILE = path.resolve(process.cwd(), 'runtime', 'relay-state.json')
const RELAY_AUTH_HEADER = 'x-codex-relay-token'

function logLine(message, extra = '') {
  const suffix = extra ? ` ${extra}` : ''
  console.log(`[relay ${new Date().toISOString()}] ${message}${suffix}`)
}

function rawDataToString(data, encoding = 'utf8') {
  if (typeof data === 'string') return data
  if (Buffer.isBuffer(data)) return data.toString(encoding)
  if (Array.isArray(data)) return Buffer.concat(data).toString(encoding)
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString(encoding)
  return Buffer.from(String(data)).toString(encoding)
}

function headerValue(value) {
  if (!value) return undefined
  if (Array.isArray(value)) return value[0]
  return value
}

function getHeader(req, name) {
  return headerValue(req.headers[name.toLowerCase()])
}

function tokenEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

function isLoopbackHost(host) {
  const h = String(host || '').trim().toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1'
}

function isLoopbackAddress(ip) {
  if (!ip) return false
  if (ip === '127.0.0.1') return true
  if (ip.startsWith('127.')) return true
  if (ip === '::1') return true
  if (ip.startsWith('::ffff:127.')) return true
  return false
}

function parseBaseUrl(rawUrl) {
  const parsed = new URL(rawUrl.trim().replace(/\/$/, ''))
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`extension relay base URL must be http(s), got ${parsed.protocol}`)
  }
  const host = parsed.hostname
  const port = parsed.port.trim() !== '' ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`extension relay base URL has invalid port: ${parsed.port || '(empty)'}`)
  }
  return {
    host,
    port,
    baseUrl: parsed.toString().replace(/\/$/, ''),
    protocol: parsed.protocol,
  }
}

async function ensureParentDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
}

async function writeStateFile(stateFile, payload) {
  await ensureParentDir(stateFile)
  await fs.writeFile(stateFile, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
}

function createTargetList(connectedTargets, cdpWsUrl) {
  return Array.from(connectedTargets.values()).map((target) => ({
    id: target.targetId,
    type: target.targetInfo.type ?? 'page',
    title: target.targetInfo.title ?? '',
    description: target.targetInfo.title ?? '',
    url: target.targetInfo.url ?? '',
    webSocketDebuggerUrl: cdpWsUrl,
    devtoolsFrontendUrl: `/devtools/inspector.html?ws=${cdpWsUrl.replace(/^ws:\/\//, '')}`,
  }))
}

export function getRelayAuthHeaderName() {
  return RELAY_AUTH_HEADER
}

export function buildRelayMetadata({ host = DEFAULT_HOST, port = DEFAULT_PORT, token, stateFile = DEFAULT_STATE_FILE } = {}) {
  const resolvedToken = token?.trim() || randomBytes(32).toString('base64url')
  const baseUrl = `http://${host}:${port}`
  return {
    host,
    port,
    baseUrl,
    cdpWsUrl: `ws://${host}:${port}/cdp`,
    extensionWsUrl: `ws://${host}:${port}/extension`,
    authHeader: RELAY_AUTH_HEADER,
    authToken: resolvedToken,
    stateFile,
  }
}

export async function startRelayServer(options = {}) {
  const metadata = buildRelayMetadata(options)
  const base = parseBaseUrl(metadata.baseUrl)

  if (!isLoopbackHost(base.host)) {
    throw new Error(`relay requires loopback host, got ${base.host}`)
  }

  /** @type {WebSocket|null} */
  let extensionWs = null
  const cdpClients = new Set()
  const connectedTargets = new Map()
  const connectedPages = new Map()
  const pendingExtension = new Map()
  let nextExtensionId = 1

  const sendToExtension = async (payload) => {
    const ws = extensionWs
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('Codex Browser Relay extension is not connected')
    }

    ws.send(JSON.stringify(payload))

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingExtension.delete(payload.id)
        reject(new Error(`extension request timeout: ${payload.params?.method || payload.method || 'unknown'}`))
      }, 30000)

      pendingExtension.set(payload.id, { resolve, reject, timer })
    })
  }

  const broadcastToCdpClients = (event) => {
    const message = JSON.stringify(event)
    for (const ws of cdpClients) {
      if (ws.readyState !== WebSocket.OPEN) continue
      ws.send(message)
    }
  }

  const sendResponseToCdp = (ws, payload) => {
    if (ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify(payload))
  }

  const ensureTargetEventsForClient = (ws, mode) => {
    for (const target of connectedTargets.values()) {
      if (mode === 'autoAttach') {
        ws.send(
          JSON.stringify({
            method: 'Target.attachedToTarget',
            params: {
              sessionId: target.sessionId,
              targetInfo: {
                ...target.targetInfo,
                attached: true,
              },
              waitingForDebugger: false,
            },
          }),
        )
      } else {
        ws.send(
          JSON.stringify({
            method: 'Target.targetCreated',
            params: {
              targetInfo: {
                ...target.targetInfo,
                attached: true,
              },
            },
          }),
        )
      }
    }
  }

  const routeCdpCommand = async (command) => {
    switch (command.method) {
      case 'Browser.getVersion':
        return {
          protocolVersion: '1.3',
          product: 'Chrome/Codex-Extension-Relay',
          revision: '0',
          userAgent: 'Codex-Extension-Relay',
          jsVersion: 'V8',
        }
      case 'Browser.setDownloadBehavior':
      case 'Target.setAutoAttach':
      case 'Target.setDiscoverTargets':
        return {}
      case 'Target.getTargets':
        return {
          targetInfos: Array.from(connectedTargets.values()).map((target) => ({
            ...target.targetInfo,
            attached: true,
          })),
        }
      case 'Target.getTargetInfo': {
        const params = command.params ?? {}
        const requestedTargetId = typeof params.targetId === 'string' ? params.targetId : undefined
        if (requestedTargetId) {
          for (const target of connectedTargets.values()) {
            if (target.targetId === requestedTargetId) {
              return { targetInfo: target.targetInfo }
            }
          }
        }
        if (command.sessionId && connectedTargets.has(command.sessionId)) {
          return { targetInfo: connectedTargets.get(command.sessionId)?.targetInfo }
        }
        return { targetInfo: Array.from(connectedTargets.values())[0]?.targetInfo }
      }
      case 'Target.attachToTarget': {
        const params = command.params ?? {}
        const targetId = typeof params.targetId === 'string' ? params.targetId : undefined
        if (!targetId) throw new Error('targetId required')
        for (const target of connectedTargets.values()) {
          if (target.targetId === targetId) return { sessionId: target.sessionId }
        }
        throw new Error('target not found')
      }
      default:
        return await sendToExtension({
          id: nextExtensionId++,
          method: 'forwardCDPCommand',
          params: {
            method: command.method,
            sessionId: command.sessionId,
            params: command.params,
          },
        })
    }
  }

  const server = createServer(async (req, res) => {
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }

    const url = new URL(req.url ?? '/', metadata.baseUrl)
    const pathname = url.pathname

    if (pathname.startsWith('/json')) {
      const token = getHeader(req, RELAY_AUTH_HEADER)
      if (!token || !tokenEquals(token, metadata.authToken)) {
        res.writeHead(401)
        res.end('Unauthorized')
        return
      }
    }

    if (req.method === 'HEAD' && pathname === '/') {
      res.writeHead(200)
      res.end()
      return
    }

    if (pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('OK')
      return
    }

    if (pathname === '/extension/status') {
      const token = getHeader(req, RELAY_AUTH_HEADER)
      if (!token || !tokenEquals(token, metadata.authToken)) {
        res.writeHead(401)
        res.end('Unauthorized')
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ connected: Boolean(extensionWs), targets: connectedTargets.size, pages: connectedPages.size }))
      return
    }

    if ((pathname === '/page/list' || pathname === '/page/list/') && req.method === 'GET') {
      const token = getHeader(req, RELAY_AUTH_HEADER)
      if (!token || !tokenEquals(token, metadata.authToken)) {
        res.writeHead(401)
        res.end('Unauthorized')
        return
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(Array.from(connectedPages.values())))
      return
    }

    if ((pathname === '/page/command' || pathname === '/page/command/') && req.method === 'POST') {
      const token = getHeader(req, RELAY_AUTH_HEADER)
      if (!token || !tokenEquals(token, metadata.authToken)) {
        res.writeHead(401)
        res.end('Unauthorized')
        return
      }

      const MAX_BODY = 1024 * 1024 // 1 MB
      let raw = ''
      let rawBytes = 0
      let aborted = false
      req.on('error', () => {
        aborted = true
        if (!res.headersSent) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'request stream error' }))
        }
      })
      req.on('data', (chunk) => {
        rawBytes += chunk.length
        if (rawBytes > MAX_BODY) {
          aborted = true
          if (!res.headersSent) {
            res.writeHead(413, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'payload too large' }))
          }
          req.destroy()
          return
        }
        raw += chunk.toString('utf8')
      })
      req.on('end', async () => {
        if (aborted) return
        try {
          const body = raw ? JSON.parse(raw) : {}
          const params = { ...body }
          const result = await sendToExtension({
            id: nextExtensionId++,
            method: 'pageCommand',
            params,
          })
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(result))
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
        }
      })
      return
    }

    const cdpWsUrl = `ws://${req.headers.host?.trim() || `${base.host}:${base.port}`}/cdp`

    if ((pathname === '/json/version' || pathname === '/json/version/') && (req.method === 'GET' || req.method === 'PUT')) {
      const payload = {
        Browser: 'Codex/extension-relay',
        'Protocol-Version': '1.3',
      }
      if (extensionWs) payload.webSocketDebuggerUrl = cdpWsUrl
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(payload))
      return
    }

    if (new Set(['/json', '/json/', '/json/list', '/json/list/']).has(pathname) && (req.method === 'GET' || req.method === 'PUT')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(createTargetList(connectedTargets, cdpWsUrl)))
      return
    }

    const activateMatch = pathname.match(/^\/json\/activate\/(.+)$/)
    if (activateMatch && (req.method === 'GET' || req.method === 'PUT')) {
      const targetId = decodeURIComponent(activateMatch[1] ?? '').trim()
      if (!targetId) {
        res.writeHead(400)
        res.end('targetId required')
        return
      }

      void sendToExtension({
        id: nextExtensionId++,
        method: 'forwardCDPCommand',
        params: {
          method: 'Target.activateTarget',
          params: { targetId },
        },
      }).catch(() => {})

      res.writeHead(200)
      res.end('OK')
      return
    }

    const closeMatch = pathname.match(/^\/json\/close\/(.+)$/)
    if (closeMatch && (req.method === 'GET' || req.method === 'PUT')) {
      const targetId = decodeURIComponent(closeMatch[1] ?? '').trim()
      if (!targetId) {
        res.writeHead(400)
        res.end('targetId required')
        return
      }

      void sendToExtension({
        id: nextExtensionId++,
        method: 'forwardCDPCommand',
        params: {
          method: 'Target.closeTarget',
          params: { targetId },
        },
      }).catch(() => {})

      res.writeHead(200)
      res.end('OK')
      return
    }

    if ((pathname === '/json/new' || pathname === '/json/new/') && (req.method === 'GET' || req.method === 'PUT')) {
      const urlToOpen = url.searchParams.get('url') || 'about:blank'
      try {
        const result = await sendToExtension({
          id: nextExtensionId++,
          method: 'forwardCDPCommand',
          params: {
            method: 'Target.createTarget',
            params: { url: urlToOpen },
          },
        })

        const targetId = typeof result?.targetId === 'string' ? result.targetId : ''
        const target = Array.from(connectedTargets.values()).find((entry) => entry.targetId === targetId)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify(
            target
              ? {
                  id: target.targetId,
                  type: target.targetInfo.type ?? 'page',
                  title: target.targetInfo.title ?? '',
                  description: target.targetInfo.title ?? '',
                  url: target.targetInfo.url ?? urlToOpen,
                  webSocketDebuggerUrl: cdpWsUrl,
                }
              : {
                  id: targetId,
                  type: 'page',
                  title: '',
                  description: '',
                  url: urlToOpen,
                  webSocketDebuggerUrl: cdpWsUrl,
                },
          ),
        )
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end(error instanceof Error ? error.message : String(error))
      }
      return
    }

    res.writeHead(404)
    res.end('not found')
  })

  const extensionServer = new WebSocketServer({ noServer: true })
  const cdpServer = new WebSocketServer({ noServer: true })

  function rejectUpgrade(socket, status, body) {
    const payload = Buffer.from(body)
    socket.write(
      `HTTP/1.1 ${status} ${status === 200 ? 'OK' : 'ERR'}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${payload.length}\r\nConnection: close\r\n\r\n`,
    )
    socket.write(payload)
    socket.end()
    try {
      socket.destroy()
    } catch {
      // Ignore teardown races.
    }
  }

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', metadata.baseUrl)
    const pathname = url.pathname
    const remoteAddress = req.socket.remoteAddress
    logLine('upgrade request', `${pathname} from ${remoteAddress || 'unknown'}`)

    if (!isLoopbackAddress(remoteAddress)) {
      rejectUpgrade(socket, 403, 'Forbidden')
      return
    }

    const origin = headerValue(req.headers.origin)
    if (origin && pathname === '/extension' && !origin.startsWith('chrome-extension://')) {
      rejectUpgrade(socket, 403, 'Forbidden: invalid origin')
      return
    }

    if (pathname === '/extension') {
      if (extensionWs) {
        rejectUpgrade(socket, 409, 'Extension already connected')
        return
      }

      extensionServer.handleUpgrade(req, socket, head, (ws) => {
        extensionServer.emit('connection', ws, req)
      })
      return
    }

    if (pathname === '/cdp') {
      const token = getHeader(req, RELAY_AUTH_HEADER)
      if (!token || !tokenEquals(token, metadata.authToken)) {
        rejectUpgrade(socket, 401, 'Unauthorized')
        return
      }
      if (!extensionWs) {
        rejectUpgrade(socket, 503, 'Extension not connected')
        return
      }

      cdpServer.handleUpgrade(req, socket, head, (ws) => {
        cdpServer.emit('connection', ws, req)
      })
      return
    }

    rejectUpgrade(socket, 404, 'Not Found')
  })

  extensionServer.on('connection', (ws) => {
    let authenticated = false
    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        logLine('extension auth timeout')
        ws.close(4001, 'Authentication timeout')
      }
    }, 5000)
    ws.once('close', () => clearTimeout(authTimeout))

    ws.on('message', function authHandler(data) {
      let msg
      try { msg = JSON.parse(rawDataToString(data)) } catch { return }
      if (msg?.method !== 'authenticate' || !tokenEquals(String(msg?.token ?? ''), metadata.authToken)) {
        logLine('extension auth failed')
        ws.close(4003, 'Authentication failed')
        return
      }
      clearTimeout(authTimeout)
      authenticated = true
      ws.removeListener('message', authHandler)
      ws.send(JSON.stringify({ method: 'authenticated' }))
      onExtensionAuthenticated(ws)
    })
  })

  function onExtensionAuthenticated(ws) {
    extensionWs = ws
    logLine('extension authenticated')

    const pingTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify({ method: 'ping' }))
    }, 5000)

    ws.on('message', (data) => {
      let parsed = null
      try {
        parsed = JSON.parse(rawDataToString(data))
      } catch {
        return
      }

      if (parsed && typeof parsed === 'object' && typeof parsed.id === 'number') {
        const pending = pendingExtension.get(parsed.id)
        if (!pending) return
        pendingExtension.delete(parsed.id)
        clearTimeout(pending.timer)
        if (typeof parsed.error === 'string' && parsed.error.trim()) {
          pending.reject(new Error(parsed.error))
        } else {
          pending.resolve(parsed.result)
        }
        return
      }

      if (!parsed || typeof parsed !== 'object') return
      if (parsed.method === 'pong') return
      if (parsed.method === 'pageAttached') {
        const page = parsed.params || {}
        if (page?.sessionId && page?.pageId) {
          connectedPages.set(page.sessionId, {
            sessionId: page.sessionId,
            pageId: page.pageId,
            tabId: page.tabId,
            page: page.page || {},
          })
        }
        return
      }
      if (parsed.method === 'pageDetached') {
        const page = parsed.params || {}
        if (page?.sessionId) connectedPages.delete(page.sessionId)
        return
      }
      if (parsed.method !== 'forwardCDPEvent') return

      const event = parsed
      const method = event.params?.method
      const params = event.params?.params
      const sessionId = event.params?.sessionId

      if (typeof method !== 'string' || !method) return

      if (method === 'Target.attachedToTarget') {
        const attached = params ?? {}
        if ((attached?.targetInfo?.type ?? 'page') !== 'page') return

        if (attached?.sessionId && attached?.targetInfo?.targetId) {
          const previous = connectedTargets.get(attached.sessionId)
          const nextTargetId = attached.targetInfo.targetId
          const previousTargetId = previous?.targetId
          const changedTarget = Boolean(previous && previousTargetId && previousTargetId !== nextTargetId)

          connectedTargets.set(attached.sessionId, {
            sessionId: attached.sessionId,
            targetId: nextTargetId,
            targetInfo: attached.targetInfo,
          })

          if (changedTarget && previousTargetId) {
            broadcastToCdpClients({
              method: 'Target.detachedFromTarget',
              params: {
                sessionId: attached.sessionId,
                targetId: previousTargetId,
              },
              sessionId: attached.sessionId,
            })
          }

          if (!previous || changedTarget) {
            broadcastToCdpClients({ method, params, sessionId })
          }
          return
        }
      }

      if (method === 'Target.detachedFromTarget') {
        const detached = params ?? {}
        if (detached?.sessionId) connectedTargets.delete(detached.sessionId)
        broadcastToCdpClients({ method, params, sessionId })
        return
      }

      if (method === 'Target.targetInfoChanged') {
        const targetInfo = params?.targetInfo
        const targetId = targetInfo?.targetId
        if (targetId && (targetInfo?.type ?? 'page') === 'page') {
          for (const [sid, target] of connectedTargets.entries()) {
            if (target.targetId !== targetId) continue
            connectedTargets.set(sid, {
              ...target,
              targetInfo: {
                ...target.targetInfo,
                ...targetInfo,
              },
            })
          }
        }
      }

      broadcastToCdpClients({ method, params, sessionId })
    })

    ws.on('close', () => {
      logLine('extension disconnected')
      clearInterval(pingTimer)
      extensionWs = null
      for (const [, pending] of pendingExtension) {
        clearTimeout(pending.timer)
        pending.reject(new Error('extension disconnected'))
      }
      pendingExtension.clear()
      connectedTargets.clear()
      connectedPages.clear()
      for (const client of cdpClients) {
        try {
          client.close(1011, 'extension disconnected')
        } catch {
          // Ignore teardown races.
        }
      }
      cdpClients.clear()
    })
  }

  cdpServer.on('connection', (ws) => {
    cdpClients.add(ws)
    logLine('cdp client connected', `count=${cdpClients.size}`)

    ws.on('message', async (data) => {
      let command = null
      try {
        command = JSON.parse(rawDataToString(data))
      } catch {
        return
      }

      if (!command || typeof command !== 'object') return
      if (typeof command.id !== 'number' || typeof command.method !== 'string') return

      if (!extensionWs) {
        sendResponseToCdp(ws, {
          id: command.id,
          sessionId: command.sessionId,
          error: { message: 'Extension not connected' },
        })
        return
      }

      try {
        const result = await routeCdpCommand(command)

        if (command.method === 'Target.setAutoAttach' && !command.sessionId) {
          ensureTargetEventsForClient(ws, 'autoAttach')
        }
        if (command.method === 'Target.setDiscoverTargets' && command.params?.discover === true) {
          ensureTargetEventsForClient(ws, 'discover')
        }
        if (command.method === 'Target.attachToTarget') {
          const targetId = typeof command.params?.targetId === 'string' ? command.params.targetId : undefined
          if (targetId) {
            const target = Array.from(connectedTargets.values()).find((entry) => entry.targetId === targetId)
            if (target) {
              ws.send(
                JSON.stringify({
                  method: 'Target.attachedToTarget',
                  params: {
                    sessionId: target.sessionId,
                    targetInfo: {
                      ...target.targetInfo,
                      attached: true,
                    },
                    waitingForDebugger: false,
                  },
                }),
              )
            }
          }
        }

        sendResponseToCdp(ws, {
          id: command.id,
          sessionId: command.sessionId,
          result,
        })
      } catch (error) {
        sendResponseToCdp(ws, {
          id: command.id,
          sessionId: command.sessionId,
          error: { message: error instanceof Error ? error.message : String(error) },
        })
      }
    })

    ws.on('close', () => {
      cdpClients.delete(ws)
      logLine('cdp client disconnected', `count=${cdpClients.size}`)
    })
  })

  await new Promise((resolve, reject) => {
    server.listen(base.port, base.host, () => resolve())
    server.once('error', reject)
  })

  await writeStateFile(metadata.stateFile, {
    ...metadata,
    startedAt: new Date().toISOString(),
    modelTarget: 'anthropic/claude-opus-4-6',
  })

  return {
    ...metadata,
    extensionConnected: () => Boolean(extensionWs),
    connectedTargetCount: () => connectedTargets.size,
    stop: async () => {
      try {
        extensionWs?.close(1001, 'server stopping')
      } catch {
        // Ignore teardown races.
      }

      for (const ws of cdpClients) {
        try {
          ws.close(1001, 'server stopping')
        } catch {
          // Ignore teardown races.
        }
      }

      for (const [, pending] of pendingExtension) {
        clearTimeout(pending.timer)
        pending.reject(new Error('server stopping'))
      }
      pendingExtension.clear()

      await new Promise((resolve) => server.close(() => resolve()))
      extensionServer.close()
      cdpServer.close()
    },
  }
}

export {
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_STATE_FILE,
}
