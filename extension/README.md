# Codex Browser Relay Extension

This folder contains a Chrome/Chromium extension scaffold based on the OpenClaw browser relay model, adapted for Codex usage.

## What it already does

- Connects the active web page to the local relay when the toolbar button is clicked.
- Opens a WebSocket to `ws://127.0.0.1:<port>/extension`.
- Forwards page interaction commands from the relay to a content script running in the page.
- Supports actions such as text extraction, selector queries, clicks, typing, and scroll-into-view on normal websites.
- Uses a Codex-inspired blue/violet icon set for the extension action and manifest assets.

## What is still missing

This repository includes a standalone relay service in `../relay-service`, so the extension no longer needs OpenClaw locally. To make it usable end to end, start that service first.

1. Start the local relay service.
2. Keep the extension pointed at the same port.
3. Connect your CDP client or Codex-side adapter to the relay.

## Files

- `manifest.json`: Manifest V3 definition.
- `background.js`: Core browser bridge between `chrome.debugger` and the local relay.
- `options.html` / `options.js`: Local port configuration and relay health check.

## Load unpacked

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this folder.
5. Start `relay-service`.
6. Click the extension on the tab you want to attach.

## Protocol sketch

The extension now expects a backend that supports a page-first relay contract:

- Health check: `HEAD http://127.0.0.1:<port>/`
- WebSocket: `ws://127.0.0.1:<port>/extension`
- Inbound commands:
  - `{ "method": "ping" }`
  - `{ "id": 1, "method": "pageCommand", "params": { "sessionId": "...", "action": "click", "selector": "button" } }`
- Outbound events:
  - `{ "method": "pageAttached", "params": { "sessionId": "...", "pageId": "...", "page": { "url": "...", "title": "..." } } }`
  - `{ "method": "pageDetached", "params": { "sessionId": "...", "pageId": "...", "reason": "toggle" } }`

## Next integration step

The next useful step is to add a Codex-side client for the new relay:

- Option A: an MCP server that speaks to `ws://127.0.0.1:18793/cdp`
- Option B: a small Node/Python client for scripted browser control
- Option C: a Playwright `connectOverCDP` adapter with the relay auth header
