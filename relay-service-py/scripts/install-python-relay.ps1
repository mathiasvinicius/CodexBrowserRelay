$ErrorActionPreference = 'Stop'

$installRoot = Join-Path $env:USERPROFILE '.codex\codex-browser-relay'
$nodeRelayDir = Join-Path $installRoot 'relay-service'
$pythonRelayDir = Join-Path $installRoot 'relay-service-py'

if (-not (Test-Path $nodeRelayDir)) {
  throw "Node relay install not found: $nodeRelayDir"
}

if (-not (Test-Path $pythonRelayDir)) {
  throw "Python relay install not found: $pythonRelayDir"
}

$cmdPath = Join-Path $nodeRelayDir 'run-relay-service.cmd'
$runtimeDir = Join-Path $nodeRelayDir 'runtime'

if (-not (Test-Path $runtimeDir)) {
  New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
}

$cmd = @"
@echo off
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

set "PY_RELAY_DIR=%USERPROFILE%\.codex\codex-browser-relay\relay-service-py"
set "STATE_FILE=%SCRIPT_DIR%\runtime\relay-state.json"
set "STDOUT_LOG=%SCRIPT_DIR%\runtime\service.stdout.log"
set "STDERR_LOG=%SCRIPT_DIR%\runtime\service.stderr.log"

if not exist "%SCRIPT_DIR%\runtime" (
  mkdir "%SCRIPT_DIR%\runtime" >nul 2>nul
)

cd /d "%PY_RELAY_DIR%"
python -m relay start --host 127.0.0.1 --port 18793 --state-file "%STATE_FILE%" >> "%STDOUT_LOG%" 2>> "%STDERR_LOG%"
"@

Set-Content -Path $cmdPath -Value $cmd -Encoding ASCII
Write-Output "Updated launcher to use Python relay: $cmdPath"
