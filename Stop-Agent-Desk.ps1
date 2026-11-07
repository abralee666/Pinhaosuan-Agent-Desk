$ErrorActionPreference = 'Stop'
$taskUrl = 'http://127.0.0.1:4317'
Invoke-WebRequest -Uri $taskUrl -SessionVariable taskSession -TimeoutSec 3 | Out-Null
Invoke-RestMethod -Uri "$taskUrl/api/shutdown" -Method Post -WebSession $taskSession -ContentType 'application/json' -Headers @{ Origin = $taskUrl; 'X-Agent-Desk' = '1' } -Body '{}' | Out-Null
Write-Output 'Agent Desk has stopped, records saved.'
