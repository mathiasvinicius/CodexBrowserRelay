param(
  [string]$SessionId,
  [string]$PageId,
  [string]$OutputPath,
  [ValidateSet('png','jpeg')]
  [string]$Format = 'png'
)

$ErrorActionPreference = 'Stop'

$body = @{
  action = 'captureVisibleTab'
  format = $Format
}

if ($SessionId) { $body.sessionId = $SessionId }
if ($PageId) { $body.pageId = $PageId }

$response = Invoke-RestMethod `
  -Method Post `
  -Uri 'http://127.0.0.1:18793/page/command' `
  -ContentType 'application/json' `
  -Body ($body | ConvertTo-Json)

if (-not $OutputPath) {
  $response | ConvertTo-Json -Depth 10
  exit 0
}

if (-not $response.imageDataUrl) {
  throw 'Capture did not return imageDataUrl.'
}

$targetPath = [System.IO.Path]::GetFullPath($OutputPath)
$targetDir = Split-Path -Parent $targetPath
if ($targetDir -and -not (Test-Path $targetDir)) {
  New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
}

$base64 = ($response.imageDataUrl -split ',', 2)[1]
$bytes = [Convert]::FromBase64String($base64)
[System.IO.File]::WriteAllBytes($targetPath, $bytes)

[PSCustomObject]@{
  ok = $true
  outputPath = $targetPath
  page = $response.page
  sessionId = $response.sessionId
  pageId = $response.pageId
} | ConvertTo-Json -Depth 10
