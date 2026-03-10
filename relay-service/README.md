# Codex Browser Relay Service

Standalone local relay service for the `Codex Browser Relay` Chrome extension.

This project keeps only the pieces needed for the extension takeover flow:

- loopback HTTP server
- WebSocket `/extension` endpoint for the Chrome extension
- WebSocket `/cdp` endpoint for CDP clients
- `/json/version` and `/json/list` endpoints compatible with common CDP tooling
- `/page/list` and `/page/command` endpoints for page-level interaction via content scripts

It does not depend on OpenClaw at runtime.

## Default port

- `18793`

The extension in this repository uses `18793` on purpose so it does not collide with the default OpenClaw relay port (`18792`).

## Install

```bash
npm install
```

## Interactive manager

On Windows, you can use the menu-driven batch file:

```bat
cd D:\Users\vinicius.mathias\Git\CodexBrowserRelay\relay-service
manage-relay.bat
```

It can:

- install or update dependencies and configure local autostart
- configure host, port, token, and state-file path
- start the relay in the current window
- start and stop the relay in background
- install and remove local autostart
- show health, logs, and the current state file

It saves your settings in:

`D:\Users\vinicius.mathias\Git\CodexBrowserRelay\relay-service\relay-config.cmd`

The manager's option `1` is now the full install flow: it runs `npm install` and then registers local autostart for the relay.

For a persistent local service outside the terminal, the project also includes:

- `run-relay-service.cmd`
- `run-relay-service.vbs`
- `scripts\install-local-service.ps1`
- `scripts\remove-local-service.ps1`

The installer now uses the hidden VBS launcher so the relay can start without leaving a visible terminal window behind.

It first tries a Windows Scheduled Task through `wscript.exe`. If Windows blocks that, it falls back to a per-user autostart entry in `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` that also points to the same `.vbs` launcher.

## Run

```bash
npm start
```

Optional flags:

```bash
node src/cli.js start --host 127.0.0.1 --port 18793 --token my-token
```

Environment variables are also supported:

- `CODEX_BROWSER_RELAY_HOST`
- `CODEX_BROWSER_RELAY_PORT`
- `CODEX_BROWSER_RELAY_TOKEN`
- `CODEX_BROWSER_RELAY_STATE_FILE`

## What to connect where

- Chrome extension -> `ws://127.0.0.1:18793/extension`
- CDP client -> `ws://127.0.0.1:18793/cdp`
- HTTP health -> `HEAD http://127.0.0.1:18793/`
- Page list -> `GET http://127.0.0.1:18793/page/list`
- Page command -> `POST http://127.0.0.1:18793/page/command`

CDP requests to `/json/*` and WebSocket `/cdp` require the header:

```text
x-codex-relay-token: <token>
```

The service prints the current token when it starts.

The page endpoints also require the same header. Example:

```powershell
$token = (Get-Content D:\Users\vinicius.mathias\Git\CodexBrowserRelay\relay-service\runtime\relay-state.json | ConvertFrom-Json).authToken
Invoke-RestMethod `
  -Method Get `
  -Uri 'http://127.0.0.1:18793/page/list' `
  -Headers @{ 'x-codex-relay-token' = $token }
```

## Model note

This relay is model-agnostic. It does not embed Claude, Codex, or any other LLM. The upstream agent/orchestrator can use whichever model you want, as long as it can speak to this relay.
