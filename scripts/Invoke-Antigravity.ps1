# Match the desktop's enabled Windows network configuration for this child only.
# Explicit CLI proxy variables take precedence. Restore the shell after exit.
$taskAgyExecutable = Join-Path $env:LOCALAPPDATA 'agy/bin/agy.exe'
if (-not (Test-Path -LiteralPath $taskAgyExecutable -PathType Leaf)) {
    throw "Antigravity CLI was not found: $taskAgyExecutable"
}
$taskProxyKeys = @('HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY')
$taskPreviousEnvironment = @{}
foreach ($taskKey in $taskProxyKeys) {
    $taskPreviousEnvironment[$taskKey] = [Environment]::GetEnvironmentVariable($taskKey, 'Process')
}
try {
    if (-not $env:HTTPS_PROXY -and -not $env:ALL_PROXY) {
        $taskInternet = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
        if ($taskInternet.ProxyEnable -eq 1 -and $taskInternet.ProxyServer) {
            $taskChoices = @($taskInternet.ProxyServer -split ';')
            $taskAddress = $taskChoices | Where-Object { $_ -match '^https=' } | Select-Object -First 1
            if (-not $taskAddress) { $taskAddress = $taskChoices | Where-Object { $_ -match '^http=' } | Select-Object -First 1 }
            if (-not $taskAddress) { $taskAddress = $taskChoices | Where-Object { $_ -notmatch '=' } | Select-Object -First 1 }
            if ($taskAddress) {
                $taskAddress = ($taskAddress -replace '^(https|http)=', '').Trim()
                if ($taskAddress -notmatch '://') { $taskAddress = 'http://' + $taskAddress }
                $taskProxyUri = $null
                if ([Uri]::TryCreate($taskAddress, [UriKind]::Absolute, [ref]$taskProxyUri) -and
                    $taskProxyUri.Scheme -in @('http', 'https') -and -not $taskProxyUri.UserInfo) {
                    $env:HTTPS_PROXY = $taskProxyUri.AbsoluteUri
                    if (-not $env:HTTP_PROXY) { $env:HTTP_PROXY = $taskProxyUri.AbsoluteUri }
                    if (-not $env:NO_PROXY) { $env:NO_PROXY = 'localhost,127.0.0.1,::1' }
                }
            }
        }
    }
    & $taskAgyExecutable @args
    $taskAgyExitCode = $LASTEXITCODE
    if ($taskAgyExitCode -ne 0 -and ($args -contains 'models' -or ($args -contains '-p' -and $args -contains '/usage'))) {
        Start-Sleep -Milliseconds 1500
        & $taskAgyExecutable @args
        $taskAgyExitCode = $LASTEXITCODE
    }
}
finally {
    foreach ($taskKey in $taskProxyKeys) {
        [Environment]::SetEnvironmentVariable($taskKey, $taskPreviousEnvironment[$taskKey], 'Process')
    }
}
if ($null -ne $taskAgyExitCode) { $global:LASTEXITCODE = $taskAgyExitCode }
