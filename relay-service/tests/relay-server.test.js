import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer as createNetServer } from 'node:net'
import test from 'node:test'
import WebSocket from 'ws'

import { startRelayServer } from '../src/relay-server.js'

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const server = createNetServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => {
        if (error) reject(error)
        else resolve(port)
      })
    })
    server.once('error', reject)
  })
}

async function startTestRelay() {
  const port = await getFreePort()
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-relay-test-'))
  const stateFile = path.join(stateDir, 'relay-state.json')
  const relay = await startRelayServer({
    host: '127.0.0.1',
    port,
    token: 'test-token-1234567890',
    stateFile,
  })
  return { relay, port, stateDir }
}

async function stopTestRelay(relay, stateDir) {
  await relay.stop()
  await fs.rm(stateDir, { recursive: true, force: true })
}

test('rejects wildcard host bind', async () => {
  const port = await getFreePort()
  const stateFile = path.join(os.tmpdir(), `codex-relay-invalid-${port}.json`)
  await assert.rejects(
    startRelayServer({
      host: '0.0.0.0',
      port,
      token: 'test-token',
      stateFile,
    }),
    /relay requires loopback host/i,
  )
})

test('page list requires auth token', async () => {
  const { relay, port, stateDir } = await startTestRelay()
  try {
    const res = await fetch(`http://127.0.0.1:${port}/page/list`)
    assert.equal(res.status, 401)
  } finally {
    await stopTestRelay(relay, stateDir)
  }
})

test('extension status requires auth token', async () => {
  const { relay, port, stateDir } = await startTestRelay()
  try {
    const withoutToken = await fetch(`http://127.0.0.1:${port}/extension/status`)
    assert.equal(withoutToken.status, 401)

    const withToken = await fetch(`http://127.0.0.1:${port}/extension/status`, {
      headers: { 'x-codex-relay-token': 'test-token-1234567890' },
    })
    assert.equal(withToken.status, 200)
    const payload = await withToken.json()
    assert.equal(payload.connected, false)
  } finally {
    await stopTestRelay(relay, stateDir)
  }
})

test('page command rejects oversized body', async () => {
  const { relay, port, stateDir } = await startTestRelay()
  try {
    const res = await fetch(`http://127.0.0.1:${port}/page/command`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-codex-relay-token': 'test-token-1234567890',
      },
      body: JSON.stringify({ payload: 'x'.repeat(1024 * 1024 + 32) }),
    })
    assert.equal(res.status, 413)
  } finally {
    await stopTestRelay(relay, stateDir)
  }
})

test('extension websocket requires authentication handshake', async () => {
  const { relay, port, stateDir } = await startTestRelay()
  try {
    const unauthenticatedClose = await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/extension`, {
        headers: { Origin: 'chrome-extension://unit-test' },
      })
      ws.once('error', reject)
      ws.once('close', (code) => resolve(code))
    })
    assert.equal(unauthenticatedClose, 4001)

    const authenticated = await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/extension`, {
        headers: { Origin: 'chrome-extension://unit-test' },
      })
      ws.once('error', reject)
      ws.on('open', () => {
        ws.send(JSON.stringify({ method: 'authenticate', token: 'test-token-1234567890' }))
      })
      ws.on('message', (data) => {
        const payload = JSON.parse(String(data))
        if (payload?.method === 'authenticated') {
          ws.close(1000, 'done')
          resolve(true)
        }
      })
    })

    assert.equal(authenticated, true)
  } finally {
    await stopTestRelay(relay, stateDir)
  }
})
