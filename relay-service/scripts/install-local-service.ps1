$ErrorActionPreference = 'Stop'

$taskName = 'CodexBrowserRelayService'
$runKeyPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$runValueName = 'CodexBrowserRelayService'
$serviceDir = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$runner = Join-Path $serviceDir 'run-relay-service.vbs'

if (-not (Test-Path $runner)) {
  throw "Runner not found: $runner"
}

$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "//B //NoLogo `"$runner`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest

try {
  try {
    $null = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  } catch {
    # Task did not exist yet.
  }

  Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description 'Runs the Codex Browser Relay service at user logon and keeps it independent from terminal sessions.' | Out-Null

  Start-ScheduledTask -TaskName $taskName

  Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, State, Author
} catch {
  if (-not (Test-Path $runKeyPath)) {
    New-Item -Path $runKeyPath -Force | Out-Null
  }

  Set-ItemProperty -Path $runKeyPath -Name $runValueName -Value "wscript.exe //B //NoLogo `"$runner`"" -Force
  Start-Process -FilePath 'wscript.exe' -ArgumentList '//B', '//NoLogo', "`"$runner`"" -WindowStyle Hidden

  [PSCustomObject]@{
    TaskName = $taskName
    State = 'RunKeyFallback'
    Author = $env:USERNAME
    StartupPath = $runKeyPath
    Runner = $runner
  }
}
