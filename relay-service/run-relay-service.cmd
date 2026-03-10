@echo off
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

if exist "%SCRIPT_DIR%\relay-config.cmd" (
  call "%SCRIPT_DIR%\relay-config.cmd"
)

if not exist "%SCRIPT_DIR%\runtime" (
  mkdir "%SCRIPT_DIR%\runtime" >nul 2>nul
)

cd /d "%SCRIPT_DIR%"
node ".\src\cli.js" start >> "%SCRIPT_DIR%\runtime\service.stdout.log" 2>> "%SCRIPT_DIR%\runtime\service.stderr.log"
