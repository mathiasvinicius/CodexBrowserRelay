# Browser Relay Contract

This extension follows the same core bridge model used by the OpenClaw browser relay extension.

## Lifecycle

1. User clicks the extension action on the current tab.
2. Extension checks `HEAD http://127.0.0.1:<port>/`.
3. Extension opens `ws://127.0.0.1:<port>/extension`.
4. Extension attaches `chrome.debugger` to the tab.
5. Extension emits a synthetic `Target.attachedToTarget` event through `forwardCDPEvent`.
6. Backend starts sending `forwardCDPCommand` requests.

## Inbound messages from relay

### Heartbeat

```json
{ "method": "ping" }
```

The extension replies with:

```json
{ "method": "pong" }
```

### Command forwarding

```json
{
  "id": 1,
  "method": "forwardCDPCommand",
  "params": {
    "sessionId": "codex-tab-1",
    "method": "Page.navigate",
    "params": {
      "url": "https://example.com"
    }
  }
}
```

The extension executes the request via `chrome.debugger.sendCommand(...)` and replies with either:

```json
{ "id": 1, "result": { "frameId": "..." } }
```

or

```json
{ "id": 1, "error": "No attached tab for method Page.navigate" }
```

## Outbound messages to relay

### Forwarded CDP events

```json
{
  "method": "forwardCDPEvent",
  "params": {
    "sessionId": "codex-tab-1",
    "method": "Page.loadEventFired",
    "params": {
      "timestamp": 12345.67
    }
  }
}
```

### Synthetic attach/detach events

The extension also synthesizes:

- `Target.attachedToTarget`
- `Target.detachedFromTarget`

These are emitted as `forwardCDPEvent` payloads so the backend can keep a session map compatible with normal CDP target flows.

## Special cases implemented by the extension

- `Runtime.enable`: forces a best-effort `Runtime.disable` first.
- `Target.createTarget`: creates a new Chrome tab and returns its `targetId`.
- `Target.closeTarget`: closes a Chrome tab.
- `Target.activateTarget`: focuses the window and activates the tab.

## Important limitation

This extension is only the browser-side bridge. A Codex-compatible relay process still needs to exist locally and decide how to transform these events and commands into Codex actions or MCP tool calls.
