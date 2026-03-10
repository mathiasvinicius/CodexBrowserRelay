# CodexBrowserRelay

Browser relay extension and local service for Codex to interact with attached Edge and Chrome tabs.

## Structure

- `extension/`: unpacked Chromium extension used to attach already-open tabs
- `relay-service/`: local Node.js relay with HTTP, WebSocket, page commands, and autostart helpers
- `skill/codex-browser-relay/`: Codex skill and helper scripts for talking to the relay

## What works today

- Attach a live browser tab through the toolbar action
- Interact with normal web pages via content scripts
- Navigate, click, type, extract text, query selectors, and wait for text
- Drive practical flows like ChatGPT image generation up to the browser-native save prompt
- Keep the same tab attached across same-tab navigation

## Quick start

### 1. Install and start the relay

```powershell
cd relay-service
npm install
manage-relay.bat
```

The interactive manager can install dependencies, configure the relay, start it in the background, and register local autostart through a hidden VBS launcher.

### 2. Load the extension

1. Open `edge://extensions` or `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the `extension/` folder
5. Confirm the relay port is `18793`
6. Click the extension icon on the page you want to attach until it shows `ON`

### 3. Use the Codex skill

The helper skill lives under `skill/codex-browser-relay/` and contains:

- `SKILL.md`
- `scripts/list_pages.ps1`
- `scripts/page_command.ps1`

## Notes

- The relay is model-agnostic. It does not embed Claude, Codex, or any other LLM.
- Browser-native save dialogs can still require user confirmation depending on current Edge/Chrome download settings.
- Internal pages like `edge://`, `chrome://`, `devtools://`, and extension pages are not controllable.
