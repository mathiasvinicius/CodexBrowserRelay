param(
  [string]$InstallUserProfile = $env:USERPROFILE
)

$ErrorActionPreference = 'Stop'

$pythonPath = (Get-Command python -ErrorAction Stop).Source
$installRoot = Join-Path $InstallUserProfile '.codex\codex-browser-relay'
$pythonRelayDir = Join-Path $installRoot 'relay-service-py'

if (-not (Test-Path $pythonRelayDir)) {
  throw "Python relay install not found: $pythonRelayDir"
}

Push-Location $pythonRelayDir
try {
  & $pythonPath -m relay.service stop | Out-Null
  & $pythonPath -m relay.service remove | Out-Null
} finally {
  Pop-Location
}

Write-Output 'Removed CodexBrowserRelayPy Windows service.'
