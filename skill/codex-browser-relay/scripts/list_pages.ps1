$ErrorActionPreference = 'Stop'

$statePath = 'C:\ProgramData\AMTECH\codex-browser-relay-service\runtime\relay-state.json'
if (-not (Test-Path $statePath)) {
  throw "Relay state file not found: $statePath"
}

$state = Get-Content -Raw $statePath | ConvertFrom-Json
$headers = @{ 'x-codex-relay-token' = $state.authToken }

Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:18793/page/list' -Headers $headers | ConvertTo-Json -Depth 8
