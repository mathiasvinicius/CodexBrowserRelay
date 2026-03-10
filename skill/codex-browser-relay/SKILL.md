---
name: codex-browser-relay
description: Interact with already-open browser tabs through the local Codex Browser Relay extension and service. Use when Codex needs to inspect text, list attached pages, navigate the current attached tab, click elements, type into inputs, or query selectors on a live page that is already open in Edge/Chrome.
---

# Codex Browser Relay

Use the local relay instead of Playwright when the user wants to work with an already-open tab that is attached through the `Codex Browser Relay` extension.

## Quick workflow

1. Confirm the relay is up by reading `C:\ProgramData\AMTECH\codex-browser-relay-service\runtime\relay-state.json`.
2. Use `scripts/list_pages.ps1` to confirm the extension is connected and a page is attached.
3. If no page is attached, tell the user to:
   - reload the extension in `edge://extensions`
   - click the extension icon on the target tab until it shows `ON`
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

## Notes

- Prefer this skill for tabs that are already open and visible in the user's browser.
- Internal browser pages such as `edge://`, `chrome://`, `devtools://`, and extension pages cannot be controlled.
- If the attached tab navigates in the same tab, the extension should reconnect automatically in current versions.
- When selectors are uncertain, use `queryDetailed` first.
- The relay can trigger browser downloads from the page, but the browser-native save confirmation may still require a manual click depending on current Edge download settings.
