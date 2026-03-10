#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_HOST, DEFAULT_PORT, DEFAULT_STATE_FILE, startRelayServer } from './relay-server.js'

function parseArgs(argv) {
  const args = [...argv]
  const command = args.shift() || 'start'
  const options = {}

  while (args.length > 0) {
    const token = args.shift()
    if (!token) break

    if (token === '--host') options.host = args.shift()
    else if (token === '--port') options.port = Number(args.shift())
    else if (token === '--token') options.token = args.shift()
    else if (token === '--state-file') options.stateFile = args.shift()
    else if (token === '--help' || token === '-h') options.help = true
  }

  return { command, options }
}

function printHelp() {
  process.stdout.write(`Codex Browser Relay Service

Usage:
  codex-browser-relay start [--host 127.0.0.1] [--port 18793] [--token TOKEN] [--state-file PATH]
  codex-browser-relay status [--state-file PATH]

Environment:
  CODEX_BROWSER_RELAY_HOST
  CODEX_BROWSER_RELAY_PORT
  CODEX_BROWSER_RELAY_TOKEN
  CODEX_BROWSER_RELAY_STATE_FILE
`)
}

async function readStateFile(stateFile) {
  const raw = await fs.readFile(stateFile, 'utf8')
  return JSON.parse(raw)
}

async function run() {
  const { command, options } = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }

  const host = options.host || process.env.CODEX_BROWSER_RELAY_HOST || DEFAULT_HOST
  const port = options.port || Number(process.env.CODEX_BROWSER_RELAY_PORT || DEFAULT_PORT)
  const token = options.token || process.env.CODEX_BROWSER_RELAY_TOKEN
  const stateFile = path.resolve(options.stateFile || process.env.CODEX_BROWSER_RELAY_STATE_FILE || DEFAULT_STATE_FILE)

  if (command === 'status') {
    const state = await readStateFile(stateFile)
    process.stdout.write(`${JSON.stringify(state, null, 2)}\n`)
    return
  }

  if (command !== 'start') {
    throw new Error(`Unknown command: ${command}`)
  }

  const relay = await startRelayServer({ host, port, token, stateFile })

  process.stdout.write(`Codex Browser Relay listening on ${relay.baseUrl}\n`)
  process.stdout.write(`Extension WebSocket: ${relay.extensionWsUrl}\n`)
  process.stdout.write(`CDP WebSocket: ${relay.cdpWsUrl}\n`)
  process.stdout.write(`Auth header: ${relay.authHeader}\n`)
  process.stdout.write(`Auth token: ${relay.authToken}\n`)
  process.stdout.write(`State file: ${relay.stateFile}\n`)
  process.stdout.write(`Model target hint: anthropic/claude-opus-4-6\n`)

  const shutdown = async (signal) => {
    process.stdout.write(`\nShutting down relay (${signal})...\n`)
    await relay.stop()
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
  process.exit(1)
})
