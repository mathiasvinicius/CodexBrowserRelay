$ErrorActionPreference = 'Stop'

$installRoot = Join-Path $env:USERPROFILE '.codex\codex-browser-relay'
$statePath = Join-Path $installRoot 'relay-service\runtime\relay-state.json'
if (-not (Test-Path $statePath)) {
  throw "Relay state file not found: $statePath"
}

Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:18793/page/list' | ConvertTo-Json -Depth 8
