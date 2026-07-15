[CmdletBinding()]
param(
    [string]$Distribution = "Ubuntu-Backup",
    [string]$RefreshScript = (Join-Path $PSScriptRoot "refresh_wsl_dokploy_portproxy.ps1"),
    [string]$LogFile = "E:\GitHub\BotManager\logs\dokploy-wsl-keepalive.log",
    [ValidateRange(1, 300)]
    [int]$RestartDelaySeconds = 5
)

$ErrorActionPreference = "Stop"

function Write-Log {
    param([Parameter(Mandatory)][string]$Message)

    try {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogFile) |
            Out-Null
        $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"), $Message
        Add-Content -LiteralPath $LogFile -Value $line -Encoding utf8
    }
    catch {
        # Logging must never stop the WSL/Docker keepalive loop.
    }
}

Write-Log "keepalive start"

while ($true) {
    try {
        if (Test-Path -LiteralPath $RefreshScript) {
            Write-Log "refresh portproxy"
            & $RefreshScript |
                Out-String |
                Add-Content -LiteralPath $LogFile -Encoding utf8
        }
    }
    catch {
        Write-Log "refresh portproxy failed; continuing WSL keepalive"
    }

    Write-Log "enter WSL keepalive"
    $exitCode = 0
    try {
        & wsl.exe -d $Distribution -u root -- bash -lc "systemctl start docker && systemctl is-active --quiet docker && while true; do sleep 3600; done"
        $exitCode = $LASTEXITCODE
    }
    catch {
        $exitCode = 1
    }

    Write-Log "WSL keepalive exited: exitCode=$exitCode; retrying"
    Start-Sleep -Seconds $RestartDelaySeconds
}
