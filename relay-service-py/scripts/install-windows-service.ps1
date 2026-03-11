param(
  [string]$InstallUserProfile = $env:USERPROFILE
)

$ErrorActionPreference = 'Stop'

$pythonPath = (Get-Command python -ErrorAction Stop).Source
$installRoot = Join-Path $InstallUserProfile '.codex\codex-browser-relay'
$pythonRelayDir = Join-Path $installRoot 'relay-service-py'
$nodeRelayDir = Join-Path $installRoot 'relay-service'
$stateFile = Join-Path $nodeRelayDir 'runtime\relay-state.json'
$configPath = Join-Path $pythonRelayDir 'service-config.json'

if (-not (Test-Path $pythonRelayDir)) {
  throw "Python relay install not found: $pythonRelayDir"
}

if (-not (Test-Path $nodeRelayDir)) {
  throw "Relay runtime folder not found: $nodeRelayDir"
}

if (-not (Test-Path (Split-Path -Parent $stateFile))) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $stateFile) | Out-Null
}

$config = @{
  host = '127.0.0.1'
  port = 18793
  stateFile = $stateFile
}
$config | ConvertTo-Json | Set-Content -Path $configPath -Encoding UTF8

Push-Location $pythonRelayDir
try {
  & $pythonPath -m pip install -e .
  if ($LASTEXITCODE -ne 0) {
    throw "python -m pip install -e . failed with exit code $LASTEXITCODE"
  }

  & $pythonPath -m relay.service --startup auto update
  if ($LASTEXITCODE -ne 0) {
    & $pythonPath -m relay.service --startup auto install
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to install CodexBrowserRelayPy Windows service."
    }
  }

  & $pythonPath -m relay.service start
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to start CodexBrowserRelayPy Windows service."
  }
} finally {
  Pop-Location
}

Get-Service -Name CodexBrowserRelayPy | Select-Object Name,DisplayName,Status,StartType
