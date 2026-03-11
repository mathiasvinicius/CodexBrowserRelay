param(
  [string]$InstallUserProfile = $env:USERPROFILE
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSCommandPath
$codexHome = Join-Path $InstallUserProfile '.codex'
$installRoot = Join-Path $codexHome 'codex-browser-relay'
$extensionTarget = Join-Path $installRoot 'extension'
$relayTarget = Join-Path $installRoot 'relay-service'
$relayPyTarget = Join-Path $installRoot 'relay-service-py'
$skillTarget = Join-Path (Join-Path $codexHome 'skills') 'codex-browser-relay'

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-CommandPath {
  param([string]$Name)
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($cmd) { return $cmd.Source }
  return $null
}

function Get-PythonVersion {
  $pythonPath = Get-CommandPath -Name 'python'
  if (-not $pythonPath) { return $null }

  try {
    $version = & $pythonPath -c "import sys; print('.'.join(map(str, sys.version_info[:3])))"
    return [Version]($version.Trim())
  } catch {
    return $null
  }
}

function Ensure-Winget {
  $wingetPath = Get-CommandPath -Name 'winget'
  if (-not $wingetPath) {
    throw 'winget was not found. Install Python 3.11+ and Node.js manually, then run install.cmd again.'
  }
  return $wingetPath
}

function Install-WithWinget {
  param(
    [Parameter(Mandatory = $true)][string]$Id,
    [Parameter(Mandatory = $true)][string]$Label
  )

  $wingetPath = Ensure-Winget
  Write-Host "Installing $Label via winget..." -ForegroundColor Yellow
  & $wingetPath install --id $Id --exact --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) {
    throw "winget failed while installing $Label (package: $Id)."
  }
}

function Ensure-Prerequisites {
  $pythonVersion = Get-PythonVersion
  if (-not $pythonVersion -or $pythonVersion -lt [Version]'3.11.0') {
    Install-WithWinget -Id 'Python.Python.3.11' -Label 'Python 3.11'
    $pythonVersion = Get-PythonVersion
    if (-not $pythonVersion -or $pythonVersion -lt [Version]'3.11.0') {
      throw 'Python 3.11+ is required. Install was attempted, but python is still unavailable in PATH. Reopen the terminal and run install.cmd again.'
    }
  }

  $nodePath = Get-CommandPath -Name 'node'
  if (-not $nodePath) {
    Install-WithWinget -Id 'OpenJS.NodeJS.LTS' -Label 'Node.js LTS'
    $nodePath = Get-CommandPath -Name 'node'
    if (-not $nodePath) {
      throw 'Node.js is required. Install was attempted, but node is still unavailable in PATH. Reopen the terminal and run install.cmd again.'
    }
  }

  $npmPath = Get-CommandPath -Name 'npm'
  if (-not $npmPath) {
    throw 'npm was not found even though Node.js appears to be installed. Reopen the terminal and run install.cmd again.'
  }

  Write-Host "Python: $pythonVersion" -ForegroundColor DarkGray
  Write-Host "Node:   $nodePath" -ForegroundColor DarkGray
  Write-Host "npm:    $npmPath" -ForegroundColor DarkGray
}

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

Ensure-Prerequisites

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
  -Source (Join-Path $repoRoot 'relay-service-py') `
  -Destination $relayPyTarget `
  -ExcludeDirs @('__pycache__', 'runtime', '.git', 'codex_browser_relay_py.egg-info') `
  -ExcludeFiles @('*.pyc', '*.log')

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

Write-Host 'Installing Python relay package...' -ForegroundColor Cyan
Push-Location $relayPyTarget
try {
  & python -m pip install -e .
  if ($LASTEXITCODE -ne 0) {
    throw "python -m pip install -e . failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

if (Test-IsAdministrator) {
  Write-Host 'Installing Python relay as a Windows service...' -ForegroundColor Cyan
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $relayPyTarget 'scripts\install-windows-service.ps1') -InstallUserProfile $InstallUserProfile
  if ($LASTEXITCODE -ne 0) {
    throw "install-windows-service.ps1 failed with exit code $LASTEXITCODE"
  }
} else {
  Write-Host 'Admin rights not detected. Windows service installation was skipped.' -ForegroundColor Yellow
  Write-Host 'Run install.cmd to allow the installer to request elevation when needed.' -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Install completed.' -ForegroundColor Green
Write-Host "Extension path: $extensionTarget"
Write-Host "Relay path:     $relayTarget"
Write-Host "Relay py path:  $relayPyTarget"
Write-Host "Skill path:     $skillTarget"
Write-Host ''
Write-Host 'Next step:' -ForegroundColor Yellow
Write-Host 'Open edge://extensions, enable Developer mode, click Load unpacked, and select the installed extension folder above.'
