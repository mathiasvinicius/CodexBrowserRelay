$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSCommandPath
$codexHome = Join-Path $env:USERPROFILE '.codex'
$installRoot = Join-Path $codexHome 'codex-browser-relay'
$extensionTarget = Join-Path $installRoot 'extension'
$relayTarget = Join-Path $installRoot 'relay-service'
$skillTarget = Join-Path (Join-Path $codexHome 'skills') 'codex-browser-relay'

function Ensure-Directory {
  param([string]$Path)
  if (-not (Test-Path $Path)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }
}

function Mirror-Directory {
  param(
    [string]$Source,
    [string]$Destination,
    [string[]]$ExcludeDirs = @(),
    [string[]]$ExcludeFiles = @()
  )

  Ensure-Directory -Path $Destination

  $roboArgs = @(
    $Source,
    $Destination,
    '/MIR',
    '/R:1',
    '/W:1',
    '/NFL',
    '/NDL',
    '/NJH',
    '/NJS',
    '/NP'
  )

  if ($ExcludeDirs.Count -gt 0) {
    $roboArgs += '/XD'
    $roboArgs += $ExcludeDirs
  }
  if ($ExcludeFiles.Count -gt 0) {
    $roboArgs += '/XF'
    $roboArgs += $ExcludeFiles
  }

  & robocopy @roboArgs | Out-Null
  if ($LASTEXITCODE -gt 7) {
    throw "robocopy failed for $Source -> $Destination with exit code $LASTEXITCODE"
  }
}

Write-Host 'Installing Codex Browser Relay into %USERPROFILE%\.codex...' -ForegroundColor Cyan
Write-Host "Install root: $installRoot"

Ensure-Directory -Path $codexHome
Ensure-Directory -Path (Join-Path $codexHome 'skills')
Ensure-Directory -Path $installRoot

Mirror-Directory `
  -Source (Join-Path $repoRoot 'extension') `
  -Destination $extensionTarget `
  -ExcludeDirs @('.git')

Mirror-Directory `
  -Source (Join-Path $repoRoot 'relay-service') `
  -Destination $relayTarget `
  -ExcludeDirs @('node_modules', 'runtime', '.git') `
  -ExcludeFiles @('relay-config.cmd', '*.log', '*.pid')

Mirror-Directory `
  -Source (Join-Path $repoRoot 'skill\codex-browser-relay') `
  -Destination $skillTarget `
  -ExcludeDirs @('.git')

Write-Host 'Installing relay dependencies...' -ForegroundColor Cyan
Push-Location $relayTarget
try {
  & npm install
  if ($LASTEXITCODE -ne 0) {
    throw "npm install failed with exit code $LASTEXITCODE"
  }

  Write-Host 'Registering local autostart...' -ForegroundColor Cyan
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $relayTarget 'scripts\install-local-service.ps1')
  if ($LASTEXITCODE -ne 0) {
    throw "install-local-service.ps1 failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

Write-Host ''
Write-Host 'Install completed.' -ForegroundColor Green
Write-Host "Extension path: $extensionTarget"
Write-Host "Relay path:     $relayTarget"
Write-Host "Skill path:     $skillTarget"
Write-Host ''
Write-Host 'Next step:' -ForegroundColor Yellow
Write-Host 'Open edge://extensions, enable Developer mode, click Load unpacked, and select the installed extension folder above.'
