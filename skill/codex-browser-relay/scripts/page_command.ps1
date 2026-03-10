param(
  [Parameter(Mandatory = $true)]
  [string]$Action,
  [string]$Selector,
  [string]$Text,
  [string]$Key,
  [string]$Url,
  [string]$SessionId,
  [string]$PageId,
  [int]$Limit,
  [switch]$Exact,
  [switch]$Append
)

$ErrorActionPreference = 'Stop'

$installRoot = Join-Path $env:USERPROFILE '.codex\codex-browser-relay'
$statePath = Join-Path $installRoot 'relay-service\runtime\relay-state.json'
if (-not (Test-Path $statePath)) {
  throw "Relay state file not found: $statePath"
}

$body = @{
  action = $Action
}

if ($Selector) { $body.selector = $Selector }
if ($Text) { $body.text = $Text }
if ($Key) { $body.key = $Key }
if ($Url) { $body.url = $Url }
if ($SessionId) { $body.sessionId = $SessionId }
if ($PageId) { $body.pageId = $PageId }
if ($PSBoundParameters.ContainsKey('Limit')) { $body.limit = $Limit }
if ($Exact.IsPresent) { $body.exact = $true }
if ($Append.IsPresent) { $body.append = $true }

Invoke-RestMethod `
  -Method Post `
  -Uri 'http://127.0.0.1:18793/page/command' `
  -ContentType 'application/json' `
  -Body ($body | ConvertTo-Json) | ConvertTo-Json -Depth 10
