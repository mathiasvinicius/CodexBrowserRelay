@echo off
setlocal EnableExtensions
set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "INSTALL_USERPROFILE=%USERPROFILE%"
set "PS_CMD=$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator); if (-not $isAdmin) { Start-Process -Verb RunAs -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','\"%SCRIPT_DIR%\install.ps1\"','-InstallUserProfile','\"%INSTALL_USERPROFILE%\"'); exit 0 } else { & '%SCRIPT_DIR%\install.ps1' -InstallUserProfile '%INSTALL_USERPROFILE%'; exit $LASTEXITCODE }"
powershell -NoProfile -ExecutionPolicy Bypass -Command "%PS_CMD%"
exit /b %ERRORLEVEL%
