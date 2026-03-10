# CodexBrowserRelay

Browser relay extension and local service for Codex to interact with attached Edge and Chrome tabs.

## Default install location

The recommended install root is:

`%USERPROFILE%\.codex\codex-browser-relay`

That install root contains:

- `extension/`
- `relay-service/`

The Codex skill is installed into:

`%USERPROFILE%\.codex\skills\codex-browser-relay`

## Structure

- `extension/`: unpacked Chromium extension used to attach already-open tabs
- `relay-service/`: local Node.js relay with HTTP, WebSocket, page commands, tests, and autostart helpers
- `skill/codex-browser-relay/`: source copy of the Codex skill and helper scripts
- `install.ps1`: full Windows installer for the default `%USERPROFILE%\.codex` layout
- `install.cmd`: convenience launcher for the PowerShell installer

## Quick install

```bat
install.cmd
```

The installer:

- copies the extension and relay service to `%USERPROFILE%\.codex\codex-browser-relay`
- copies the skill to `%USERPROFILE%\.codex\skills\codex-browser-relay`
- runs `npm install` inside the installed relay service
- registers local autostart through the hidden VBS launcher
- starts the relay service

## After install

1. Open `edge://extensions` or `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select `%USERPROFILE%\.codex\codex-browser-relay\extension`
5. Click the extension icon on a normal web page until it shows `ON`

## What works today

- attach a live browser tab through the toolbar action
- interact with normal web pages via content scripts
- navigate, click, type, extract text, query selectors, and wait for text
- drive practical flows like ChatGPT image generation and download
- keep the same tab attached across same-tab navigation

## Notes

- the relay is model-agnostic and does not embed Claude, Codex, or any other LLM
- the default install flow does not require a relay token
- internal pages like `edge://`, `chrome://`, `devtools://`, and extension pages are not controllable
