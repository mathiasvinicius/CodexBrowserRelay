param(
  [Parameter(Mandatory = $true)]
  [string]$SessionId,
  [int]$MaxLessons = 10,
  [int]$SecondsFromEnd = 1,
  [int]$PauseAfterSeekSeconds = 4,
  [int]$PauseAfterNextSeconds = 4
)

$ErrorActionPreference = 'Stop'

function Invoke-RelayPageCommand {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$Body
  )

  Invoke-RestMethod `
    -Method Post `
    -Uri 'http://127.0.0.1:18793/page/command' `
    -ContentType 'application/json' `
    -Body ($Body | ConvertTo-Json -Depth 10)
}

for ($i = 0; $i -lt $MaxLessons; $i++) {
  $media = Invoke-RelayPageCommand @{
    action = 'getMediaState'
    selector = 'video'
    sessionId = $SessionId
  }

  if ($media.media.duration -ne $null) {
    Invoke-RelayPageCommand @{
      action = 'seekMediaToEnd'
      selector = 'video'
      sessionId = $SessionId
      secondsFromEnd = $SecondsFromEnd
      fireEnded = $true
    } | Out-Null
    Start-Sleep -Seconds $PauseAfterSeekSeconds
  }

  $next = Invoke-RelayPageCommand @{
    action = 'goToNextUdemyLecture'
    sessionId = $SessionId
  }

  Start-Sleep -Seconds $PauseAfterNextSeconds

  [PSCustomObject]@{
    step = $i + 1
    nextHref = $next.nextHref
    nextText = $next.nextText
  } | ConvertTo-Json -Depth 6
}
