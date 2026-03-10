@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

set "CONFIG_FILE=%SCRIPT_DIR%\relay-config.cmd"
set "RUNTIME_DIR=%SCRIPT_DIR%\runtime"
set "PID_FILE=%RUNTIME_DIR%\relay-service.pid"
set "STDOUT_LOG=%RUNTIME_DIR%\relay.stdout.log"
set "STDERR_LOG=%RUNTIME_DIR%\relay.stderr.log"
set "VBS_RUNNER=%SCRIPT_DIR%\run-relay-service.vbs"

call :ensure_runtime
call :ensure_config

:menu
call :load_config
cls
echo ==========================================
echo   Codex Browser Relay Service Manager
echo ==========================================
echo.
echo Service folder : %SCRIPT_DIR%
echo Host           : %CODEX_BROWSER_RELAY_HOST%
echo Port           : %CODEX_BROWSER_RELAY_PORT%
echo State file     : %CODEX_BROWSER_RELAY_STATE_FILE%
echo.
call :print_running_state
echo.
echo [1] Install or update dependencies
echo [2] Configure relay
echo [3] Start relay in this window
echo [4] Start relay in background
echo [5] Stop background relay
echo [6] Show status
echo [7] Open service folder
echo [8] Install local service/autostart ^(VBS hidden^)
echo [9] Remove local service/autostart
echo [0] Exit
echo.
set "MENU_CHOICE="
set /p "MENU_CHOICE=Choose an option: "

if "%MENU_CHOICE%"=="1" goto install
if "%MENU_CHOICE%"=="2" goto configure
if "%MENU_CHOICE%"=="3" goto start_foreground
if "%MENU_CHOICE%"=="4" goto start_background
if "%MENU_CHOICE%"=="5" goto stop_background
if "%MENU_CHOICE%"=="6" goto status
if "%MENU_CHOICE%"=="7" goto open_folder
if "%MENU_CHOICE%"=="8" goto install_local_service
if "%MENU_CHOICE%"=="9" goto remove_local_service
if "%MENU_CHOICE%"=="0" goto end
goto menu

:install
call :load_config
cls
echo Installing dependencies...
pushd "%SCRIPT_DIR%"
call npm install
set "INSTALL_EXIT=%ERRORLEVEL%"
popd
echo.
if not "%INSTALL_EXIT%"=="0" (
  echo npm install failed with exit code %INSTALL_EXIT%.
) else (
  echo Dependencies installed successfully.
  echo.
  echo Installing local service/autostart...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%\scripts\install-local-service.ps1"
  echo.
  echo Install flow completed.
)
pause
goto menu

:configure
call :load_config
cls
echo Configure relay values. Press Enter to keep the current value.
echo.

set "INPUT_HOST="
set /p "INPUT_HOST=Host [%CODEX_BROWSER_RELAY_HOST%]: "
if not "%INPUT_HOST%"=="" set "CODEX_BROWSER_RELAY_HOST=%INPUT_HOST%"

set "INPUT_PORT="
set /p "INPUT_PORT=Port [%CODEX_BROWSER_RELAY_PORT%]: "
if not "%INPUT_PORT%"=="" set "CODEX_BROWSER_RELAY_PORT=%INPUT_PORT%"

set "INPUT_STATE_FILE="
set /p "INPUT_STATE_FILE=State file [%CODEX_BROWSER_RELAY_STATE_FILE%]: "
if not "%INPUT_STATE_FILE%"=="" set "CODEX_BROWSER_RELAY_STATE_FILE=%INPUT_STATE_FILE%"

call :save_config
echo.
echo Configuration saved to:
echo %CONFIG_FILE%
pause
goto menu

:start_foreground
call :load_config
cls
echo Starting relay in this window...
echo Press Ctrl+C to stop.
echo.
pushd "%SCRIPT_DIR%"
set "CODEX_BROWSER_RELAY_HOST=%CODEX_BROWSER_RELAY_HOST%"
set "CODEX_BROWSER_RELAY_PORT=%CODEX_BROWSER_RELAY_PORT%"
set "CODEX_BROWSER_RELAY_STATE_FILE=%CODEX_BROWSER_RELAY_STATE_FILE%"
node ".\src\cli.js" start
set "START_EXIT=%ERRORLEVEL%"
popd
echo.
echo Relay exited with code %START_EXIT%.
pause
goto menu

:start_background
call :load_config
call :ensure_runtime
call :is_running
if "!RUNNING!"=="1" (
  echo Relay is already running in background.
  pause
  goto menu
)

del /q "%STDOUT_LOG%" "%STDERR_LOG%" 2>nul

echo Starting relay in background...
set "PS_SCRIPT=$env:CODEX_BROWSER_RELAY_HOST='%CODEX_BROWSER_RELAY_HOST%';"
set "PS_SCRIPT=%PS_SCRIPT% $env:CODEX_BROWSER_RELAY_PORT='%CODEX_BROWSER_RELAY_PORT%';"
set "PS_SCRIPT=%PS_SCRIPT% $env:CODEX_BROWSER_RELAY_STATE_FILE='%CODEX_BROWSER_RELAY_STATE_FILE%';"
set "PS_SCRIPT=%PS_SCRIPT% $p = Start-Process -FilePath 'node' -ArgumentList @('.\src\cli.js','start') -WorkingDirectory '%SCRIPT_DIR%' -RedirectStandardOutput '%STDOUT_LOG%' -RedirectStandardError '%STDERR_LOG%' -PassThru;"
set "PS_SCRIPT=%PS_SCRIPT% Set-Content -Path '%PID_FILE%' -Value $p.Id"

powershell -NoProfile -ExecutionPolicy Bypass -Command "%PS_SCRIPT%"
set "BG_EXIT=%ERRORLEVEL%"
if not "%BG_EXIT%"=="0" (
  echo Failed to start relay in background.
  pause
  goto menu
)

timeout /t 2 >nul
call :print_status
pause
goto menu

:stop_background
call :ensure_runtime
if not exist "%PID_FILE%" (
  echo No PID file found. Nothing to stop.
  pause
  goto menu
)

for /f "usebackq delims=" %%I in ("%PID_FILE%") do set "RELAY_PID=%%I"
if "%RELAY_PID%"=="" (
  echo PID file is empty.
  pause
  goto menu
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "Stop-Process -Id %RELAY_PID% -Force -ErrorAction SilentlyContinue"
timeout /t 1 >nul
del /q "%PID_FILE%" 2>nul
echo Relay stop command sent.
pause
goto menu

:status
call :load_config
call :print_status
pause
goto menu

:open_folder
start "" "%SCRIPT_DIR%"
goto menu

:install_local_service
cls
echo Installing local service/autostart using hidden VBS launcher...
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%\scripts\install-local-service.ps1"
echo.
pause
goto menu

:remove_local_service
cls
echo Removing local service/autostart...
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%\scripts\remove-local-service.ps1"
echo.
pause
goto menu

:print_status
cls
echo ==========================================
echo   Relay Status
echo ==========================================
echo.
call :print_running_state
echo.
echo HTTP health:
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { (Invoke-WebRequest -UseBasicParsing -Method Head 'http://%CODEX_BROWSER_RELAY_HOST%:%CODEX_BROWSER_RELAY_PORT%/').StatusCode } catch { 'unreachable' }"
echo.
if exist "%CODEX_BROWSER_RELAY_STATE_FILE%" (
  echo State file:
  type "%CODEX_BROWSER_RELAY_STATE_FILE%"
) else (
  echo State file not found:
  echo %CODEX_BROWSER_RELAY_STATE_FILE%
)
echo.
if exist "%STDOUT_LOG%" (
  echo Last stdout log:
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content -Tail 20 '%STDOUT_LOG%'"
  echo.
)
if exist "%STDERR_LOG%" (
  echo Last stderr log:
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content -Tail 20 '%STDERR_LOG%'"
  echo.
)
goto :eof

:print_running_state
call :is_running
if "!RUNNING!"=="1" (
  if /I "!RUNNING_SOURCE!"=="health" (
    echo Background relay : RUNNING ^(detected by HTTP health^)
  ) else (
    echo Background relay : RUNNING ^(PID !RUNNING_PID! via !RUNNING_SOURCE!^)
  )
) else (
  echo Background relay : STOPPED
)
goto :eof

:is_running
set "RUNNING=0"
set "RUNNING_PID="
set "RUNNING_SOURCE="

if exist "%PID_FILE%" (
  for /f "usebackq delims=" %%I in ("%PID_FILE%") do set "RUNNING_PID=%%I"
  if not "!RUNNING_PID!"=="" (
    tasklist /FI "PID eq !RUNNING_PID!" | find "!RUNNING_PID!" >nul 2>nul
    if "!ERRORLEVEL!"=="0" (
      set "RUNNING=1"
      set "RUNNING_SOURCE=pid-file"
      goto :eof
    ) else (
      del /q "%PID_FILE%" 2>nul
      set "RUNNING_PID="
    )
  )
)

for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'codex-browser-relay-service' -or $_.CommandLine -match 'src\\cli.js start' } | Select-Object -First 1 -ExpandProperty ProcessId; if ($p) { $p }"`) do set "RUNNING_PID=%%I"
if not "!RUNNING_PID!"=="" (
  set "RUNNING=1"
  set "RUNNING_SOURCE=process-scan"
  goto :eof
)

for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "try { (Invoke-WebRequest -UseBasicParsing -Method Head 'http://%CODEX_BROWSER_RELAY_HOST%:%CODEX_BROWSER_RELAY_PORT%/').StatusCode } catch { '' }"`) do set "HEALTH_STATUS=%%I"
if "!HEALTH_STATUS!"=="200" (
  set "RUNNING=1"
  set "RUNNING_SOURCE=health"
)
goto :eof

:ensure_runtime
if not exist "%RUNTIME_DIR%" mkdir "%RUNTIME_DIR%" >nul 2>nul
goto :eof

:ensure_config
if exist "%CONFIG_FILE%" goto :eof
set "CODEX_BROWSER_RELAY_HOST=127.0.0.1"
set "CODEX_BROWSER_RELAY_PORT=18793"
set "CODEX_BROWSER_RELAY_STATE_FILE=%RUNTIME_DIR%\relay-state.json"
call :save_config
goto :eof

:load_config
call "%CONFIG_FILE%"
goto :eof

:save_config
(
  echo @echo off
  echo set "CODEX_BROWSER_RELAY_HOST=%CODEX_BROWSER_RELAY_HOST%"
  echo set "CODEX_BROWSER_RELAY_PORT=%CODEX_BROWSER_RELAY_PORT%"
  echo set "CODEX_BROWSER_RELAY_STATE_FILE=%CODEX_BROWSER_RELAY_STATE_FILE%"
) > "%CONFIG_FILE%"
goto :eof

:end
endlocal
exit /b 0
