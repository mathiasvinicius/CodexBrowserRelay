param(
  [Parameter(Mandatory = $true)]
  [string]$SessionId,
  [int]$MaxLessons = 10,
  [int]$SecondsFromEnd = 1,
  [int]$PauseAfterSeekSeconds = 4,
  [int]$PauseAfterNextSeconds = 4
)

$ErrorActionPreference = 'Stop'

function Invoke-WithRetry {
  param(
    [Parameter(Mandatory = $true)]
    [scriptblock]$Script,
    [int]$Retries = 8,
    [int]$DelaySeconds = 3
  )

  $lastError = $null
  for ($attempt = 0; $attempt -lt $Retries; $attempt++) {
    try {
      return & $Script
    } catch {
      $lastError = $_
      Start-Sleep -Seconds $DelaySeconds
    }
  }

  throw $lastError
}

function Get-AttachedPage {
  param(
    [Parameter(Mandatory = $true)]
    [string]$PreferredSessionId
  )

  $pages = Invoke-WithRetry { Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:18793/page/list' }
  if (-not $pages) {
    throw 'No attached pages found.'
  }

  $preferred = $pages | Where-Object { $_.sessionId -eq $PreferredSessionId } | Select-Object -First 1
  if ($preferred) { return $preferred }

  $udemy = $pages | Where-Object { $_.page.url -like 'https://ibm-learning.udemy.com/*' } | Select-Object -First 1
  if ($udemy) { return $udemy }

  return $pages | Select-Object -First 1
}

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
  $currentPage = Get-AttachedPage -PreferredSessionId $SessionId
  $activeSessionId = $currentPage.sessionId
  $activePageId = $currentPage.pageId

  $media = $null
  try {
    $media = Invoke-WithRetry {
      Invoke-RelayPageCommand @{
        action = 'getMediaState'
        selector = 'video'
        sessionId = $activeSessionId
        pageId = $activePageId
      }
    }
  } catch {
    $media = $null
  }

  if ($media -and $media.media.duration -ne $null) {
    Invoke-WithRetry {
      Invoke-RelayPageCommand @{
        action = 'seekMediaToEnd'
        selector = 'video'
        sessionId = $activeSessionId
        pageId = $activePageId
        secondsFromEnd = $SecondsFromEnd
        fireEnded = $true
      }
    } | Out-Null
    Start-Sleep -Seconds $PauseAfterSeekSeconds
  }

  $advanced = $false
  $next = $null

  try {
    $next = Invoke-WithRetry {
      Invoke-RelayPageCommand @{
        action = 'clickText'
        text = 'A seguir'
        selector = 'button, a, [role="button"], div, span'
        sessionId = $activeSessionId
        pageId = $activePageId
      }
    }
    $advanced = $true
  } catch {
    try {
      $next = Invoke-WithRetry {
        Invoke-RelayPageCommand @{
          action = 'goToNextUdemyLecture'
          sessionId = $activeSessionId
          pageId = $activePageId
        }
      }
      $advanced = $true
    } catch {
      $advanced = $false
    }
  }

  if ($advanced) {
    Start-Sleep -Seconds $PauseAfterNextSeconds
  } else {
    Start-Sleep -Seconds $PauseAfterNextSeconds
  }

  $nextPage = Get-AttachedPage -PreferredSessionId $activeSessionId

  [PSCustomObject]@{
    step = $i + 1
    sessionId = $activeSessionId
    pageId = $activePageId
    nextHref = $next.nextHref
    nextText = $next.nextText
    advanced = $advanced
    resultingSessionId = $nextPage.sessionId
    resultingPageId = $nextPage.pageId
    resultingUrl = $nextPage.page.url
  } | ConvertTo-Json -Depth 6
}
