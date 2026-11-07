$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$taskUrl = 'http://127.0.0.1:4317'
$taskLocalPublicKey = Join-Path $taskRoot 'data/user/license-public.pem'
if (-not $env:AGENT_DESK_LICENSE_PUBLIC_KEY_FILE -and (Test-Path -LiteralPath $taskLocalPublicKey)) {
  $env:AGENT_DESK_LICENSE_PUBLIC_KEY_FILE = $taskLocalPublicKey
}
try {
  $taskResponse = Invoke-WebRequest -Uri $taskUrl -TimeoutSec 2
  if ($taskResponse.Content -notmatch 'Agent Desk') { throw 'Port 4317 is occupied by another application.' }
} catch {
  if ($_.Exception.Message -match 'Port 4317 is occupied') { throw }
  $taskNode = (Get-Command node.exe -ErrorAction Stop).Source
  $taskLogs = Join-Path $taskRoot 'logs'
  New-Item -ItemType Directory -Path $taskLogs -Force | Out-Null
  Start-Process -FilePath $taskNode -ArgumentList @('server.mjs') -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskLogs 'server.log') -RedirectStandardError (Join-Path $taskLogs 'server-error.log')
  $taskReady = $false
  for ($taskAttempt = 0; $taskAttempt -lt 20; $taskAttempt++) {
    Start-Sleep -Milliseconds 250
    try { $taskResponse = Invoke-WebRequest -Uri $taskUrl -TimeoutSec 1; $taskReady = $true; break } catch { }
  }
  if (-not $taskReady) { throw 'Start failed, please check logs/server-error.log.' }
}
Start-Process $taskUrl
