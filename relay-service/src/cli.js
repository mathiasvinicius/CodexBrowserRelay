#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_HOST, DEFAULT_PORT, DEFAULT_STATE_FILE, startRelayServer } from './relay-server.js'

function parseArgs(argv) {
  const args = [...argv]
  const command = args.shift() || 'start'
  const options = {}

  while (args.length > 0) {
    const arg = args.shift()
    if (!arg) break

    if (arg === '--host') options.host = args.shift()
    else if (arg === '--port') options.port = Number(args.shift())
    else if (arg === '--state-file') options.stateFile = args.shift()
    else if (arg === '--help' || arg === '-h') options.help = true
  }

  return { command, options }
}

function printHelp() {
  process.stdout.write(`Codex Browser Relay Service

Usage:
  codex-browser-relay start [--host 127.0.0.1] [--port 18793] [--state-file PATH]
  codex-browser-relay status [--state-file PATH]

Environment:
  CODEX_BROWSER_RELAY_HOST
  CODEX_BROWSER_RELAY_PORT
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
  const stateFile = path.resolve(options.stateFile || process.env.CODEX_BROWSER_RELAY_STATE_FILE || DEFAULT_STATE_FILE)

  if (command === 'status') {
    const state = await readStateFile(stateFile)
    process.stdout.write(`${JSON.stringify(state, null, 2)}\n`)
    return
  }

  if (command !== 'start') {
    throw new Error(`Unknown command: ${command}`)
  }

  const relay = await startRelayServer({ host, port, stateFile })

  process.stdout.write(`Codex Browser Relay listening on ${relay.baseUrl}\n`)
  process.stdout.write(`Extension WebSocket: ${relay.extensionWsUrl}\n`)
  process.stdout.write(`CDP WebSocket: ${relay.cdpWsUrl}\n`)
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
