[CmdletBinding()]
param(
    [string]$Distribution = "Ubuntu-Backup",
    [string]$RefreshScript = "",
    [string]$LogFile = "E:\GitHub\BotManager\logs\dokploy-wsl-keepalive.log",
    [string]$LanAddress = "192.168.0.99",
    [int[]]$ManagedLanPorts = @(3220, 3221, 3222),
    [ValidateRange(0, 30)]
    [int]$ListenerRecoveryDelaySeconds = 1,
    [ValidateRange(15, 3600)]
    [int]$PortProxyHealthIntervalSeconds = 60,
    [ValidateRange(1, 300)]
    [int]$RestartDelaySeconds = 5
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($RefreshScript)) {
    $RefreshScript = Join-Path $PSScriptRoot "refresh-wsl-dokploy-portproxy.ps1"
}

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

function Get-ManagedPortProxyMappings {
    $output = @(& netsh.exe interface portproxy show v4tov4)
    if ($LASTEXITCODE -ne 0) {
        throw "Could not read Windows portproxy mappings."
    }

    foreach ($line in $output) {
        if ($line -match '^\s*(\d{1,3}(?:\.\d{1,3}){3})\s+(\d+)\s+(\d{1,3}(?:\.\d{1,3}){3})\s+(\d+)\s*$') {
            [pscustomobject]@{
                ListenAddress  = $Matches[1]
                ListenPort     = [int]$Matches[2]
                ConnectAddress = $Matches[3]
                ConnectPort    = [int]$Matches[4]
            }
        }
    }
}

function Get-ManagedPortProxyListeners {
    Get-NetTCPConnection -State Listen -ErrorAction Stop |
        Select-Object LocalAddress, LocalPort, State
}

function Get-PortProxyListenerRecoveryPlan {
    param(
        [Parameter(Mandatory)][string]$LanAddress,
        [Parameter(Mandatory)][int[]]$ManagedPorts,
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Mappings,
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Listeners,
        [Parameter(Mandatory)][string]$ServiceStatus
    )

    $configuredPorts = @(
        $Mappings |
            Where-Object {
                $_.ListenAddress -eq $LanAddress -and
                $ManagedPorts -contains [int]$_.ListenPort
            } |
            ForEach-Object { [int]$_.ListenPort } |
            Sort-Object -Unique
    )
    $missingPorts = @(
        $configuredPorts |
            Where-Object {
                $port = $_
                -not ($Listeners | Where-Object {
                    [int]$_.LocalPort -eq $port -and
                    $_.LocalAddress -in @($LanAddress, "0.0.0.0", "::")
                } | Select-Object -First 1)
            }
    )

    $action = "none"
    if ($missingPorts.Count -gt 0) {
        if ($ServiceStatus -eq "Stopped") {
            $action = "start_iphlpsvc"
        }
        else {
            $action = "restart_iphlpsvc"
        }
    }

    [pscustomobject]@{
        ConfiguredPorts = @($configuredPorts)
        MissingPorts    = @($missingPorts)
        Action          = $action
    }
}

function Invoke-PortProxyListenerRecovery {
    [CmdletBinding()]
    param(
        [string]$LanAddress = "192.168.0.99",
        [int[]]$ManagedPorts = @(3220, 3221, 3222),
        [scriptblock]$MappingProvider = { Get-ManagedPortProxyMappings },
        [scriptblock]$ListenerProvider = { Get-ManagedPortProxyListeners },
        [scriptblock]$ServiceStatusProvider = {
            [string](Get-Service -Name iphlpsvc -ErrorAction Stop).Status
        },
        [scriptblock]$RestartIpHelper = {
            Restart-Service -Name iphlpsvc -Force -ErrorAction Stop
        },
        [scriptblock]$StartIpHelper = {
            Start-Service -Name iphlpsvc -ErrorAction Stop
        },
        [scriptblock]$SleepAction = {
            param($Seconds)
            if ($Seconds -gt 0) {
                Start-Sleep -Seconds $Seconds
            }
        },
        [scriptblock]$LogAction = {
            param($Message)
            Write-Log -Message $Message
        },
        [ValidateRange(0, 30)]
        [int]$RecoveryDelaySeconds = 1
    )

    $configuredPorts = @()
    $missingPorts = @()
    $action = "none"

    try {
        $mappings = @(& $MappingProvider)
        $configuredPorts = @(
            $mappings |
                Where-Object {
                    $_.ListenAddress -eq $LanAddress -and
                    $ManagedPorts -contains [int]$_.ListenPort
                } |
                ForEach-Object { [int]$_.ListenPort } |
                Sort-Object -Unique
        )
        if ($configuredPorts.Count -eq 0) {
            return [pscustomobject]@{
                Status          = "not_configured"
                ConfiguredPorts = @()
                MissingPorts    = @()
                Action          = "none"
            }
        }

        $listeners = @(& $ListenerProvider)
        $serviceStatus = [string](& $ServiceStatusProvider)
        $plan = Get-PortProxyListenerRecoveryPlan `
            -LanAddress $LanAddress `
            -ManagedPorts $ManagedPorts `
            -Mappings $mappings `
            -Listeners $listeners `
            -ServiceStatus $serviceStatus
        $configuredPorts = @($plan.ConfiguredPorts)
        $missingPorts = @($plan.MissingPorts)
        $action = $plan.Action

        if ($missingPorts.Count -eq 0) {
            & $LogAction ("portproxy listener healthy ports={0}" -f ($configuredPorts -join ","))
            return [pscustomobject]@{
                Status          = "healthy"
                ConfiguredPorts = @($configuredPorts)
                MissingPorts    = @()
                Action          = "none"
            }
        }

        & $LogAction ("portproxy listener missing ports={0} action={1}" -f ($missingPorts -join ","), $action)
        if ($action -eq "start_iphlpsvc") {
            & $StartIpHelper
        }
        else {
            & $RestartIpHelper
        }
        & $SleepAction $RecoveryDelaySeconds

        $listenersAfterRecovery = @(& $ListenerProvider)
        $postPlan = Get-PortProxyListenerRecoveryPlan `
            -LanAddress $LanAddress `
            -ManagedPorts $ManagedPorts `
            -Mappings $mappings `
            -Listeners $listenersAfterRecovery `
            -ServiceStatus "Running"
        $missingAfterRecovery = @($postPlan.MissingPorts)
        if ($missingAfterRecovery.Count -eq 0) {
            & $LogAction ("portproxy listener recovery result=success ports={0}" -f ($missingPorts -join ","))
            return [pscustomobject]@{
                Status          = "recovered"
                ConfiguredPorts = @($configuredPorts)
                MissingPorts    = @()
                Action          = $action
            }
        }

        & $LogAction ("portproxy listener recovery result=failed ports={0}" -f ($missingAfterRecovery -join ","))
        return [pscustomobject]@{
            Status          = "failed"
            ConfiguredPorts = @($configuredPorts)
            MissingPorts    = @($missingAfterRecovery)
            Action          = $action
        }
    }
    catch {
        try {
            & $LogAction ("portproxy listener recovery result=failed ports={0}" -f ($missingPorts -join ","))
        }
        catch {
            # Recovery logging must never stop the WSL/Docker keepalive loop.
        }
        return [pscustomobject]@{
            Status          = "failed"
            ConfiguredPorts = @($configuredPorts)
            MissingPorts    = @($missingPorts)
            Action          = $action
        }
    }
}

function Start-WslDokployKeepalive {
    Write-Log "keepalive start"
    $refreshRequired = $true
    $keepaliveAnnounced = $false

    while ($true) {
        if ($refreshRequired) {
            try {
                if (Test-Path -LiteralPath $RefreshScript) {
                    Write-Log "refresh portproxy"
                    $null = & $RefreshScript
                    $refreshRequired = $false
                }
            }
            catch {
                Write-Log "refresh portproxy failed; continuing WSL keepalive"
            }
        }

        $null = Invoke-PortProxyListenerRecovery `
            -LanAddress $LanAddress `
            -ManagedPorts $ManagedLanPorts `
            -RecoveryDelaySeconds $ListenerRecoveryDelaySeconds

        if (-not $keepaliveAnnounced) {
            Write-Log "enter WSL keepalive"
            $keepaliveAnnounced = $true
        }
        $exitCode = 0
        try {
            & wsl.exe -d $Distribution -u root -- bash -lc "systemctl start docker && systemctl is-active --quiet docker && sleep $PortProxyHealthIntervalSeconds"
            $exitCode = $LASTEXITCODE
        }
        catch {
            $exitCode = 1
        }

        if ($exitCode -eq 0) {
            continue
        }

        $refreshRequired = $true
        $keepaliveAnnounced = $false
        Write-Log "WSL keepalive exited: exitCode=$exitCode; retrying"
        Start-Sleep -Seconds $RestartDelaySeconds
    }
}

if ($MyInvocation.InvocationName -ne ".") {
    Start-WslDokployKeepalive
}
