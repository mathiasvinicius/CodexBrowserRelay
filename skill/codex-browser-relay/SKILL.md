---
name: codex-browser-relay
description: Interact with already-open browser tabs through the local Codex Browser Relay extension and service. Use when Codex needs to inspect text, list attached pages, navigate the current attached tab, click elements, type into inputs, or query selectors on a live page that is already open in Edge/Chrome.
---

# Codex Browser Relay

Use the local relay instead of Playwright when the user wants to work with an already-open tab that is attached through the `Codex Browser Relay` extension.

## Quick workflow

1. Confirm the relay is up by reading `%USERPROFILE%\.codex\codex-browser-relay\relay-service\runtime\relay-state.json`.
2. Use `scripts/list_pages.ps1` to confirm the extension is connected and a page is attached.
   On machines using the Python backend as a Windows service, the service name is `CodexBrowserRelayPy`.
3. If no page is attached, tell the user to:
   - reload the extension in `edge://extensions`
   - click the extension icon to open the popup
   - use `Attach Current Tab`
   - confirm the unpacked extension was loaded from `%USERPROFILE%\.codex\codex-browser-relay\extension`
4. Use `scripts/page_command.ps1` for live interaction.

## Supported page actions

- `getPageInfo`
- `extractText`
- `query`
- `queryDetailed`
- `findByText`
- `click`
- `clickText`
- `type`
- `pressKey`
- `waitForText`
- `submitComposer`
- `scrollIntoView`
- `navigate`
- `captureVisibleTab`
- `getMediaState`
- `seekMediaToEnd`
- `goToNextUdemyLecture`

## Usage

List attached pages:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/list_pages.ps1
```

Navigate the attached page:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/page_command.ps1 -Action navigate -Url https://example.com
```

Extract text from a selector:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/page_command.ps1 -Action extractText -Selector h1
```

Type into a selector:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/page_command.ps1 -Action type -Selector '#prompt-textarea' -Text 'Hello'
```

Click a selector:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/page_command.ps1 -Action click -Selector 'button[type="submit"]'
```

Inspect multiple matches with a limit:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/page_command.ps1 -Action queryDetailed -Selector 'button, a, img' -Limit 80
```

Press a key on the selected element:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/page_command.ps1 -Action pressKey -Selector '#prompt-textarea' -Key Enter
```

Find or click by visible text:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/page_command.ps1 -Action findByText -Text 'Imagem criada'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/page_command.ps1 -Action clickText -Text 'Compartilhar'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/page_command.ps1 -Action clickText -Text 'Commit changes' -Selector 'div[role="dialog"] button' -Exact
```

ChatGPT image flow:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/page_command.ps1 -Action type -Selector '#prompt-textarea' -Text 'Crie uma imagem simples de um gato astronauta em estilo ilustração, com fundo azul.'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/page_command.ps1 -Action click -Selector '#composer-submit-button'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/page_command.ps1 -Action click -Selector 'button[aria-label="Baixar essa imagem"]'
```

Capture the current attached tab for visual inspection:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\capture_page.ps1 -SessionId codex-page-1 -OutputPath "$env:TEMP\codex-browser-relay.png"
```

Manual visual capture is also available from the extension popup through:

- `Capture Visible`

Advance the current Udemy lecture to the end and jump to the next one:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\advance_udemy.ps1 -SessionId codex-page-1 -MaxLessons 10
```

Validated Udemy behavior:

- video lessons can be marked complete by seeking the player to the end
- text-only lessons need an explicit wait before advancing
- the current script uses a longer wait for reading/text lessons and a short wait for video lessons
- the script can be left running in the background for long sequences of lessons

## Notes

- Prefer this skill for tabs that are already open and visible in the user's browser.
- The default install layout is `%USERPROFILE%\.codex\codex-browser-relay`.
- The validated Windows service backend name is `CodexBrowserRelayPy`.
- The current extension popup supports manual `Attach Current Tab` and `Capture Visible`.
- Internal browser pages such as `edge://`, `chrome://`, `devtools://`, and extension pages cannot be controlled.
- If the attached tab navigates in the same tab, the extension should reconnect automatically in current versions.
- When selectors are uncertain, use `queryDetailed` first.
- Use `capture_page.ps1` when visual inspection of the attached tab would help before interacting further.
- Use `advance_udemy.ps1` for the specific Udemy workflow where a lecture is considered complete only after the video reaches the end or, for text lessons, after a reading delay.
- The relay can trigger browser downloads from the page, but the browser-native save confirmation may still require a manual click depending on current Edge download settings.
