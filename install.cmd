@echo off
setlocal EnableExtensions
set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%\install.ps1"
exit /b %ERRORLEVEL%
