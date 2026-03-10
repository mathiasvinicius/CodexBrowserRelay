$ErrorActionPreference = 'Stop'

$taskName = 'CodexBrowserRelayService'
$runKeyPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$runValueName = 'CodexBrowserRelayService'

try {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
} catch {
  # Ignore if it is not running.
}

try {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Output "Removed scheduled task: $taskName"
} catch {
  Write-Output "Scheduled task not found: $taskName"
}

try {
  Remove-ItemProperty -Path $runKeyPath -Name $runValueName -ErrorAction Stop
  Write-Output "Removed HKCU Run entry: $runValueName"
} catch {
  Write-Output "HKCU Run entry not found: $runValueName"
}
