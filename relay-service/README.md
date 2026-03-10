# Codex Browser Relay Service

Standalone local relay service for the `Codex Browser Relay` extension.

This service keeps only the pieces needed for the browser takeover flow:

- loopback HTTP server
- WebSocket `/extension` endpoint for the browser extension
- WebSocket `/cdp` endpoint for CDP clients
- `/json/version` and `/json/list` endpoints for common CDP tooling
- `/page/list` and `/page/command` endpoints for page-level interaction through content scripts

It does not depend on OpenClaw at runtime.

## Default port

- `18793`

## Default install location

The recommended install root is:

`%USERPROFILE%\.codex\codex-browser-relay\relay-service`

## Install

```bash
npm install
```

## Interactive manager

On Windows, you can use the menu-driven batch file:

```bat
cd %USERPROFILE%\.codex\codex-browser-relay\relay-service
manage-relay.bat
```

It can:

- install or update dependencies and configure local autostart
- configure host, port, and state-file path
- start the relay in the current window
- start and stop the relay in background
- install and remove local autostart
- show health, logs, and the current state file

It saves your settings in:

`%USERPROFILE%\.codex\codex-browser-relay\relay-service\relay-config.cmd`

The manager's option `1` is the full install flow: it runs `npm install` and then registers local autostart for the relay.

For a persistent local service outside the terminal, the project also includes:

- `run-relay-service.cmd`
- `run-relay-service.vbs`
- `scripts\install-local-service.ps1`
- `scripts\remove-local-service.ps1`

The installer uses the hidden VBS launcher so the relay can start without leaving a visible terminal window behind.

## Run

```bash
npm start
```

Optional flags:

```bash
node src/cli.js start --host 127.0.0.1 --port 18793
```

Environment variables are also supported:

- `CODEX_BROWSER_RELAY_HOST`
- `CODEX_BROWSER_RELAY_PORT`
- `CODEX_BROWSER_RELAY_STATE_FILE`

## Test

```bash
npm test
```

## What to connect where

- Browser extension -> `ws://127.0.0.1:18793/extension`
- CDP client -> `ws://127.0.0.1:18793/cdp`
- HTTP health -> `HEAD http://127.0.0.1:18793/`
- Page list -> `GET http://127.0.0.1:18793/page/list`
- Page command -> `POST http://127.0.0.1:18793/page/command`

The relay is designed for loopback-only local automation. The default install flow does not require a token.

## Model note

This relay is model-agnostic. It does not embed Claude, Codex, or any other LLM. The upstream agent/orchestrator can use whichever model you want, as long as it can speak to this relay.
