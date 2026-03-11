const BRAND = 'Codex Browser Relay'
const DEFAULT_PORT = 18793

const BADGE = {
  on: { text: 'ON', color: '#4E66FF' },
  off: { text: '', color: '#000000' },
  connecting: { text: '...', color: '#7C87FF' },
  error: { text: '!', color: '#B91C1C' },
}

/** @type {WebSocket|null} */
let relayWs = null
/** @type {Promise<void>|null} */
let relayConnectPromise = null

let debuggerListenersInstalled = false
let nextSession = 1
let nextPageSession = 1

/** @type {Map<number, {state:'connecting'|'connected', sessionId?:string, targetId?:string, attachOrder?:number}>} */
const tabs = new Map()
/** @type {Map<string, number>} */
const tabBySession = new Map()
/** @type {Map<string, number>} */
const childSessionToTab = new Map()
/** @type {Map<number, {resolve:(v:any)=>void, reject:(e:Error)=>void}>} */
const pending = new Map()
/** @type {Map<number, {tabId:number, url:string, title?:string}>} */
const lastAttachableTabByWindow = new Map()
/** @type {Map<number, {state:'connecting'|'connected', sessionId:string, pageId:string, url?:string, title?:string}>} */
const pageTabs = new Map()
/** @type {Map<string, number>} */
const tabByPageSession = new Map()
/** @type {Set<number>} */
const desiredAttachedPageTabs = new Set()
/** @type {Set<number>} */
const autoAttachInFlight = new Set()

function isUnsupportedTabUrl(url) {
  const raw = String(url || '').trim().toLowerCase()
  return (
    raw === '' ||
    raw.startsWith('chrome://') ||
    raw.startsWith('edge://') ||
    raw.startsWith('microsoft-edge://') ||
    raw.startsWith('devtools://') ||
    raw.startsWith('chrome-extension://') ||
    raw.startsWith('edge-extension://') ||
    raw.startsWith('about:')
  )
}

function isProtectedContextError(message) {
  const raw = String(message || '').toLowerCase()
  return (
    raw.includes('chrome-extension://') ||
    raw.includes('edge-extension://') ||
    raw.includes('cannot access') ||
    raw.includes('different extension')
  )
}

function normalizeAttachError(message, candidateUrl) {
  const raw = String(message || '')
  if (isProtectedContextError(raw)) {
    return `Browser protected page blocked the attach flow. In Edge, keep a normal https tab focused and try again. Candidate URL: ${candidateUrl || '(unknown)'}`
  }
  return raw
}

function pageIdForTab(tabId) {
  return `page-${tabId}`
}

async function setLastError(message, context = {}) {
  try {
    await chrome.storage.local.set({
      lastErrorMessage: String(message || ''),
      lastErrorAt: new Date().toISOString(),
      lastErrorContext: context,
    })
  } catch {
    // Ignore storage write failures.
  }
}

async function clearLastError() {
  try {
    await chrome.storage.local.remove(['lastErrorMessage', 'lastErrorAt', 'lastErrorContext'])
  } catch {
    // Ignore storage cleanup failures.
  }
}

function rememberAttachableTab(tab) {
  const tabId = tab?.id
  const windowId = tab?.windowId
  const url = String(tab?.url || '')
  if (!tabId || !windowId || isUnsupportedTabUrl(url)) return

  lastAttachableTabByWindow.set(windowId, {
    tabId,
    url,
    title: typeof tab.title === 'string' ? tab.title : '',
  })
}

async function buildSyntheticTargetInfo(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null)
  return {
    targetId: `codex-target-${tabId}`,
    type: 'page',
    title: typeof tab?.title === 'string' ? tab.title : '',
    url: typeof tab?.url === 'string' ? tab.url : '',
    attached: true,
    canAccessOpener: false,
  }
}

function forgetAttachableTab(tabId) {
  for (const [windowId, entry] of lastAttachableTabByWindow.entries()) {
    if (entry.tabId === tabId) lastAttachableTabByWindow.delete(windowId)
  }
}

async function seedAttachableTabs() {
  try {
    const allTabs = await chrome.tabs.query({})
    for (const tab of allTabs) rememberAttachableTab(tab)
  } catch {
    // Ignore startup seeding failures.
  }
}

async function resolveCandidateTab(activeTab) {
  if (activeTab?.id && !isUnsupportedTabUrl(activeTab?.url)) {
    rememberAttachableTab(activeTab)
    return { tab: activeTab, reason: 'active' }
  }

  const fallback = activeTab?.windowId ? lastAttachableTabByWindow.get(activeTab.windowId) : null
  if (fallback?.tabId) {
    const tab = await chrome.tabs.get(fallback.tabId).catch(() => null)
    if (tab?.id && !isUnsupportedTabUrl(tab.url)) {
      rememberAttachableTab(tab)
      return { tab, reason: 'fallback' }
    }
  }

  const currentWindowTabs = activeTab?.windowId
    ? await chrome.tabs.query({ windowId: activeTab.windowId })
    : []
  const candidate =
    currentWindowTabs.find((tab) => tab.id && !isUnsupportedTabUrl(tab.url)) ||
    null

  if (candidate?.id) {
    rememberAttachableTab(candidate)
    return { tab: candidate, reason: 'window-scan' }
  }

  return { tab: null, reason: 'none' }
}

function nowStack() {
  try {
    return new Error().stack || ''
  } catch {
    return ''
  }
}

async function getRelayPort() {
  const stored = await chrome.storage.local.get(['relayPort'])
  const raw = stored.relayPort
  const n = Number.parseInt(String(raw || ''), 10)
  if (!Number.isFinite(n) || n <= 0 || n > 65535) return DEFAULT_PORT
  return n
}

function setBadge(tabId, kind) {
  const cfg = BADGE[kind]
  void chrome.action.setBadgeText({ tabId, text: cfg.text })
  void chrome.action.setBadgeBackgroundColor({ tabId, color: cfg.color })
  void chrome.action.setBadgeTextColor({ tabId, color: '#FFFFFF' }).catch(() => {})
}

async function ensureRelayConnection() {
  if (relayWs && relayWs.readyState === WebSocket.OPEN) return
  if (relayConnectPromise) return await relayConnectPromise

  relayConnectPromise = (async () => {
    const port = await getRelayPort()
    const httpBase = `http://127.0.0.1:${port}`
    const wsUrl = `ws://127.0.0.1:${port}/extension`

    try {
      await fetch(`${httpBase}/`, { method: 'HEAD', signal: AbortSignal.timeout(2000) })
    } catch (err) {
      throw new Error(`Relay server not reachable at ${httpBase} (${String(err)})`)
    }

    const ws = new WebSocket(wsUrl)
    relayWs = ws

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('WebSocket connect timeout')), 5000)
      ws.onopen = () => {
        clearTimeout(t)
        resolve()
      }
      ws.onerror = () => {
        clearTimeout(t)
        reject(new Error('WebSocket connect failed'))
      }
      ws.onclose = (ev) => {
        clearTimeout(t)
        reject(new Error(`WebSocket closed (${ev.code} ${ev.reason || 'no reason'})`))
      }
    })

    ws.onmessage = (event) => void onRelayMessage(String(event.data || ''))
    ws.onclose = () => onRelayClosed('closed')
    ws.onerror = () => onRelayClosed('error')

    if (!debuggerListenersInstalled) {
      debuggerListenersInstalled = true
      chrome.debugger.onEvent.addListener(onDebuggerEvent)
      chrome.debugger.onDetach.addListener(onDebuggerDetach)
    }
  })()

  try {
    await relayConnectPromise
  } finally {
    relayConnectPromise = null
  }
}

function onRelayClosed(reason) {
  relayWs = null
  for (const [id, p] of pending.entries()) {
    pending.delete(id)
    p.reject(new Error(`Relay disconnected (${reason})`))
  }

  for (const tabId of tabs.keys()) {
    void chrome.debugger.detach({ tabId }).catch(() => {})
    setBadge(tabId, 'connecting')
    void chrome.action.setTitle({
      tabId,
      title: `${BRAND}: disconnected (click to re-attach)`,
    })
  }
  for (const tabId of pageTabs.keys()) {
    setBadge(tabId, 'connecting')
    void chrome.action.setTitle({
      tabId,
      title: `${BRAND}: disconnected (click to re-attach)`,
    })
  }
  tabs.clear()
  tabBySession.clear()
  childSessionToTab.clear()
  pageTabs.clear()
  tabByPageSession.clear()
  autoAttachInFlight.clear()
}

function sendToRelay(payload) {
  const ws = relayWs
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error('Relay not connected')
  }
  ws.send(JSON.stringify(payload))
}

async function maybeOpenHelpOnce() {
  try {
    const stored = await chrome.storage.local.get(['helpOnErrorShown'])
    if (stored.helpOnErrorShown === true) return
    await chrome.storage.local.set({ helpOnErrorShown: true })
    await chrome.runtime.openOptionsPage()
  } catch {
    // Ignore UX niceties on worker failures.
  }
}

async function onRelayMessage(text) {
  /** @type {any} */
  let msg
  try {
    msg = JSON.parse(text)
  } catch {
    return
  }

  if (msg && msg.method === 'ping') {
    try {
      sendToRelay({ method: 'pong' })
    } catch {
      // Ignore best-effort heartbeat failures.
    }
    return
  }

  if (msg && typeof msg.id === 'number' && (msg.result !== undefined || msg.error !== undefined)) {
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.error) p.reject(new Error(String(msg.error)))
    else p.resolve(msg.result)
    return
  }

  if (msg && typeof msg.id === 'number' && msg.method === 'forwardCDPCommand') {
    try {
      const result = await handleForwardCdpCommand(msg)
      sendToRelay({ id: msg.id, result })
    } catch (err) {
      sendToRelay({ id: msg.id, error: err instanceof Error ? err.message : String(err) })
    }
    return
  }

  if (msg && typeof msg.id === 'number' && msg.method === 'pageCommand') {
    try {
      const result = await handlePageCommand(msg)
      sendToRelay({ id: msg.id, result })
    } catch (err) {
      sendToRelay({ id: msg.id, error: err instanceof Error ? err.message : String(err) })
    }
  }
}

function getTabBySessionId(sessionId) {
  const direct = tabBySession.get(sessionId)
  if (direct) return { tabId: direct, kind: 'main' }
  const child = childSessionToTab.get(sessionId)
  if (child) return { tabId: child, kind: 'child' }
  return null
}

function getTabByTargetId(targetId) {
  for (const [tabId, tab] of tabs.entries()) {
    if (tab.targetId === targetId) return tabId
  }
  return null
}

async function attachTab(tabId, opts = {}) {
  const debuggee = { tabId }
  await chrome.debugger.attach(debuggee, '1.3')
  await chrome.debugger.sendCommand(debuggee, 'Page.enable').catch(() => {})

  let targetInfo = null
  try {
    const info = /** @type {any} */ (await chrome.debugger.sendCommand(debuggee, 'Target.getTargetInfo'))
    targetInfo = info?.targetInfo || null
  } catch {
    targetInfo = await buildSyntheticTargetInfo(tabId)
  }
  const targetId = String(targetInfo?.targetId || '').trim() || `codex-target-${tabId}`
  if (!targetInfo) targetInfo = await buildSyntheticTargetInfo(tabId)
  if (!String(targetInfo?.targetId || '').trim()) targetInfo.targetId = targetId

  const sessionId = `codex-tab-${nextSession++}`
  const attachOrder = nextSession

  tabs.set(tabId, { state: 'connected', sessionId, targetId, attachOrder })
  tabBySession.set(sessionId, tabId)
  void clearLastError()
  void chrome.action.setTitle({
    tabId,
    title: `${BRAND}: attached (click to detach)`,
  })

  if (!opts.skipAttachedEvent) {
    sendToRelay({
      method: 'forwardCDPEvent',
      params: {
        method: 'Target.attachedToTarget',
        params: {
          sessionId,
          targetInfo: { ...targetInfo, attached: true },
          waitingForDebugger: false,
        },
      },
    })
  }

  setBadge(tabId, 'on')
  return { sessionId, targetId }
}

async function attachPageTab(tab) {
  const tabId = tab?.id
  if (!tabId) throw new Error('Missing tabId for page attach')

  const pageInfo = await ensurePageBridge(tabId)

  if (!pageInfo?.ok) {
    throw new Error(pageInfo?.error || 'Content script did not respond')
  }

  const sessionId = `codex-page-${nextPageSession++}`
  const pageId = pageIdForTab(tabId)
  const page = pageInfo.page || {}

  pageTabs.set(tabId, {
    state: 'connected',
    sessionId,
    pageId,
    url: page.url || tab.url || '',
    title: page.title || tab.title || '',
  })
  tabByPageSession.set(sessionId, tabId)
  desiredAttachedPageTabs.add(tabId)

  sendToRelay({
    method: 'pageAttached',
    params: {
      sessionId,
      pageId,
      tabId,
      page: {
        url: page.url || tab.url || '',
        title: page.title || tab.title || '',
        readyState: page.readyState || '',
      },
    },
  })

  void clearLastError()
  setBadge(tabId, 'on')
  void chrome.action.setTitle({
    tabId,
    title: `${BRAND}: page connected (click to detach)`,
  })

  return { sessionId, pageId }
}

async function sendPageCommand(tabId, command) {
  return await chrome.tabs.sendMessage(tabId, {
    type: 'PAGE_COMMAND',
    command,
  })
}

async function captureAttachedTab(tabId, format = 'png') {
  const tab = await chrome.tabs.get(tabId).catch(() => null)
  if (!tab?.id) throw new Error('Attached tab not found for capture')

  if (tab.windowId) {
    await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {})
  }
  await chrome.tabs.update(tabId, { active: true }).catch(() => {})
  await new Promise((resolve) => setTimeout(resolve, 150))

  const imageDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format })
  const pageTab = pageTabs.get(tabId)

  return {
    ok: true,
    imageDataUrl,
    imageFormat: format,
    page: {
      url: pageTab?.url || tab.url || '',
      title: pageTab?.title || tab.title || '',
      readyState: 'complete',
    },
  }
}

async function ensurePageBridge(tabId) {
  try {
    const ping = await sendPageCommand(tabId, { action: 'ping' })
    if (ping?.ok) return ping
  } catch {
    // Try injecting below.
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js'],
  })

  await new Promise((resolve) => setTimeout(resolve, 120))

  const retry = await sendPageCommand(tabId, { action: 'ping' })
  if (!retry?.ok) {
    throw new Error(retry?.error || 'Page bridge did not respond after injection')
  }
  return retry
}

async function detachTab(tabId, reason) {
  const tab = tabs.get(tabId)
  if (tab?.sessionId && tab?.targetId) {
    try {
      sendToRelay({
        method: 'forwardCDPEvent',
        params: {
          method: 'Target.detachedFromTarget',
          params: { sessionId: tab.sessionId, targetId: tab.targetId, reason },
        },
      })
    } catch {
      // Ignore teardown race conditions.
    }
  }

  if (tab?.sessionId) tabBySession.delete(tab.sessionId)
  tabs.delete(tabId)

  for (const [childSessionId, parentTabId] of childSessionToTab.entries()) {
    if (parentTabId === tabId) childSessionToTab.delete(childSessionId)
  }

  try {
    await chrome.debugger.detach({ tabId })
  } catch {
    // Ignore detach when tab already vanished.
  }

  setBadge(tabId, 'off')
  void chrome.action.setTitle({
    tabId,
    title: `${BRAND} (click to attach/detach)`,
  })
}

async function detachPageTab(tabId, reason) {
  const pageTab = pageTabs.get(tabId)
  if (!pageTab) {
    desiredAttachedPageTabs.delete(tabId)
    return
  }

  try {
    sendToRelay({
      method: 'pageDetached',
      params: {
        sessionId: pageTab.sessionId,
        pageId: pageTab.pageId,
        tabId,
        reason,
      },
    })
  } catch {
    // Ignore relay teardown races.
  }

  tabByPageSession.delete(pageTab.sessionId)
  pageTabs.delete(tabId)
  desiredAttachedPageTabs.delete(tabId)
  setBadge(tabId, 'off')
  void chrome.action.setTitle({
    tabId,
    title: `${BRAND} (click to attach/detach)`,
  })
}

async function detachPageTabPreserveIntent(tabId, reason) {
  const pageTab = pageTabs.get(tabId)
  if (!pageTab) return

  try {
    sendToRelay({
      method: 'pageDetached',
      params: {
        sessionId: pageTab.sessionId,
        pageId: pageTab.pageId,
        tabId,
        reason,
      },
    })
  } catch {
    // Ignore relay teardown races.
  }

  tabByPageSession.delete(pageTab.sessionId)
  pageTabs.delete(tabId)
  setBadge(tabId, 'connecting')
  void chrome.action.setTitle({
    tabId,
    title: `${BRAND}: waiting for page reload to reconnect...`,
  })
}

async function ensureDesiredPageAttach(tab) {
  const tabId = tab?.id
  if (!tabId) return
  if (!desiredAttachedPageTabs.has(tabId)) return
  if (isUnsupportedTabUrl(tab?.url)) return
  if (autoAttachInFlight.has(tabId)) return

  autoAttachInFlight.add(tabId)
  try {
    pageTabs.set(tabId, {
      state: 'connecting',
      sessionId: '',
      pageId: pageIdForTab(tabId),
      url: tab?.url || '',
      title: tab?.title || '',
    })
    setBadge(tabId, 'connecting')
    void chrome.action.setTitle({
      tabId,
      title: `${BRAND}: reconnecting page after navigation...`,
    })
    await ensureRelayConnection()
    await attachPageTab(tab)
  } catch (error) {
    const message = normalizeAttachError(error instanceof Error ? error.message : String(error), tab?.url || '')
    pageTabs.delete(tabId)
    setBadge(tabId, 'error')
    void chrome.action.setTitle({
      tabId,
      title: `${BRAND}: ${message.slice(0, 80)}`,
    })
    void setLastError(message, { tabId, url: tab?.url || '' })
  } finally {
    autoAttachInFlight.delete(tabId)
  }
}

async function connectOrToggleForTab(clickedTab) {
  const active =
    clickedTab?.id
      ? clickedTab
      : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
  const { tab: candidate, reason } = await resolveCandidateTab(active)
  const tabId = candidate?.id
  if (!tabId) {
    const message = `No attachable website tab found. Active tab was: ${active?.url || '(unknown URL)'}`
    if (active?.id) {
      setBadge(active.id, 'error')
      void chrome.action.setTitle({
        tabId: active.id,
        title: `${BRAND}: open a normal website tab first`,
      })
    }
    void setLastError(message, { tabId: active?.id || 0, url: active?.url || '' })
    return
  }

  if (reason !== 'active' && active?.id) {
    void chrome.action.setTitle({
      tabId: active.id,
      title: `${BRAND}: using last normal website tab instead of current internal page`,
    })
  }

  const existing = tabs.get(tabId)
  if (existing?.state === 'connected') {
    await detachTab(tabId, 'toggle')
    return
  }

  const existingPage = pageTabs.get(tabId)
  if (existingPage?.state === 'connected') {
    await detachPageTab(tabId, 'toggle')
    return
  }

  desiredAttachedPageTabs.add(tabId)
  pageTabs.set(tabId, {
    state: 'connecting',
    sessionId: '',
    pageId: pageIdForTab(tabId),
    url: candidate?.url || '',
    title: candidate?.title || '',
  })
  setBadge(tabId, 'connecting')
  void chrome.action.setTitle({
    tabId,
    title: `${BRAND}: connecting page to local relay...`,
  })

  try {
    if (candidate?.windowId) {
      await chrome.windows.update(candidate.windowId, { focused: true }).catch(() => {})
    }
    await chrome.tabs.update(tabId, { active: true }).catch(() => {})
    await ensureRelayConnection()
    await attachPageTab(candidate)
  } catch (err) {
    pageTabs.delete(tabId)
    setBadge(tabId, 'error')
    const normalized = normalizeAttachError(err instanceof Error ? err.message : String(err), candidate?.url || active?.url || '')
    void chrome.action.setTitle({
      tabId,
      title: `${BRAND}: ${normalized.slice(0, 80)}`,
    })
    void maybeOpenHelpOnce()
    void setLastError(normalized, { tabId, url: candidate?.url || active?.url || '' })
    console.warn('attach failed', normalized, nowStack())
  }
}

async function handleForwardCdpCommand(msg) {
  const method = String(msg?.params?.method || '').trim()
  const params = msg?.params?.params || undefined
  const sessionId = typeof msg?.params?.sessionId === 'string' ? msg.params.sessionId : undefined

  const bySession = sessionId ? getTabBySessionId(sessionId) : null
  const targetId = typeof params?.targetId === 'string' ? params.targetId : undefined
  const tabId =
    bySession?.tabId ||
    (targetId ? getTabByTargetId(targetId) : null) ||
    (() => {
      for (const [id, tab] of tabs.entries()) {
        if (tab.state === 'connected') return id
      }
      return null
    })()

  if (!tabId) throw new Error(`No attached tab for method ${method}`)

  /** @type {chrome.debugger.DebuggerSession} */
  const debuggee = { tabId }

  if (method === 'Runtime.enable') {
    try {
      await chrome.debugger.sendCommand(debuggee, 'Runtime.disable')
      await new Promise((r) => setTimeout(r, 50))
    } catch {
      // Ignore if runtime was not enabled.
    }
    return await chrome.debugger.sendCommand(debuggee, 'Runtime.enable', params)
  }

  if (method === 'Target.createTarget') {
    const url = typeof params?.url === 'string' ? params.url : 'about:blank'
    const tab = await chrome.tabs.create({ url, active: false })
    if (!tab.id) throw new Error('Failed to create tab')
    await new Promise((r) => setTimeout(r, 100))
    const attached = await attachTab(tab.id)
    return { targetId: attached.targetId }
  }

  if (method === 'Target.closeTarget') {
    const target = typeof params?.targetId === 'string' ? params.targetId : ''
    const toClose = target ? getTabByTargetId(target) : tabId
    if (!toClose) return { success: false }
    try {
      await chrome.tabs.remove(toClose)
    } catch {
      return { success: false }
    }
    return { success: true }
  }

  if (method === 'Target.activateTarget') {
    const target = typeof params?.targetId === 'string' ? params.targetId : ''
    const toActivate = target ? getTabByTargetId(target) : tabId
    if (!toActivate) return {}
    const tab = await chrome.tabs.get(toActivate).catch(() => null)
    if (!tab) return {}
    if (tab.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {})
    }
    await chrome.tabs.update(toActivate, { active: true }).catch(() => {})
    return {}
  }

  const tabState = tabs.get(tabId)
  const mainSessionId = tabState?.sessionId
  const debuggerSession =
    sessionId && mainSessionId && sessionId !== mainSessionId
      ? { ...debuggee, sessionId }
      : debuggee

  return await chrome.debugger.sendCommand(debuggerSession, method, params)
}

async function handlePageCommand(msg) {
  const action = String(msg?.params?.action || '').trim()
  const sessionId = typeof msg?.params?.sessionId === 'string' ? msg.params.sessionId : ''
  const pageId = typeof msg?.params?.pageId === 'string' ? msg.params.pageId : ''
  const tabId =
    (sessionId && tabByPageSession.get(sessionId)) ||
    (() => {
      if (!pageId) return null
      for (const [candidateTabId, info] of pageTabs.entries()) {
        if (info.pageId === pageId) return candidateTabId
      }
      return null
    })() ||
    (() => {
      for (const [candidateTabId, info] of pageTabs.entries()) {
        if (info.state === 'connected') return candidateTabId
      }
      return null
    })()

  if (!tabId) throw new Error(`No connected page tab for action ${action}`)

  if (action === 'captureVisibleTab') {
    const format = String(msg?.params?.format || 'png').trim().toLowerCase() === 'jpeg' ? 'jpeg' : 'png'
    const response = await captureAttachedTab(tabId, format)
    const pageTab = pageTabs.get(tabId)
    return {
      ...response,
      tabId,
      sessionId: pageTab?.sessionId || sessionId,
      pageId: pageTab?.pageId || pageId,
    }
  }

  await ensurePageBridge(tabId)

  const rawParams = { ...(msg?.params || {}) }
  delete rawParams.sessionId
  delete rawParams.pageId

  const response = await sendPageCommand(tabId, rawParams)

  if (!response?.ok) {
    throw new Error(response?.error || `Page command failed: ${action}`)
  }

  const pageTab = pageTabs.get(tabId)
  if (pageTab && response?.page) {
    pageTab.url = response.page.url || pageTab.url
    pageTab.title = response.page.title || pageTab.title
  }

  return {
    ...response,
    tabId,
    sessionId: pageTab?.sessionId || sessionId,
    pageId: pageTab?.pageId || pageId,
  }
}

function onDebuggerEvent(source, method, params) {
  const tabId = source.tabId
  if (!tabId) return
  const tab = tabs.get(tabId)
  if (!tab?.sessionId) return

  if (method === 'Target.attachedToTarget' && params?.sessionId) {
    childSessionToTab.set(String(params.sessionId), tabId)
  }

  if (method === 'Target.detachedFromTarget' && params?.sessionId) {
    childSessionToTab.delete(String(params.sessionId))
  }

  try {
    sendToRelay({
      method: 'forwardCDPEvent',
      params: {
        sessionId: source.sessionId || tab.sessionId,
        method,
        params,
      },
    })
  } catch {
    // Ignore relay loss; detach handler will clean up.
  }
}

function onDebuggerDetach(source, reason) {
  const tabId = source.tabId
  if (!tabId) return
  if (!tabs.has(tabId)) return
  void detachTab(tabId, reason)
}

chrome.action.onClicked.addListener((tab) => void connectOrToggleForTab(tab))

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null)
  if (tab) rememberAttachableTab(tab)
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    rememberAttachableTab({ ...tab, id: tabId })
  }

  if (desiredAttachedPageTabs.has(tabId) && changeInfo.status === 'loading') {
    if (pageTabs.has(tabId)) {
      void detachPageTabPreserveIntent(tabId, 'navigation')
    } else {
      setBadge(tabId, 'connecting')
      void chrome.action.setTitle({
        tabId,
        title: `${BRAND}: navigating, will reconnect...`,
      })
    }
  }

  if (desiredAttachedPageTabs.has(tabId) && changeInfo.status === 'complete') {
    void ensureDesiredPageAttach({ ...tab, id: tabId })
  }

  const attached = tabs.get(tabId)
  if (!attached?.sessionId) return
  if (!attached?.targetId) return
  if (!changeInfo.url && !changeInfo.title) return

  const nextTargetInfo = {
    targetId: attached.targetId,
    type: 'page',
    title: typeof tab?.title === 'string' ? tab.title : '',
    url: typeof tab?.url === 'string' ? tab.url : '',
    attached: true,
    canAccessOpener: false,
  }

  try {
    sendToRelay({
      method: 'forwardCDPEvent',
      params: {
        sessionId: attached.sessionId,
        method: 'Target.targetInfoChanged',
        params: { targetInfo: nextTargetInfo },
      },
    })
  } catch {
    // Ignore relay races during tab updates.
  }
})

chrome.tabs.onRemoved.addListener((tabId) => {
  forgetAttachableTab(tabId)
  void detachPageTab(tabId, 'tab-removed')
  desiredAttachedPageTabs.delete(tabId)
  autoAttachInFlight.delete(tabId)
})

chrome.runtime.onInstalled.addListener(() => {
  void chrome.runtime.openOptionsPage()
  void seedAttachableTabs()
})

void seedAttachableTabs()
