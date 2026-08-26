[CmdletBinding()]
param(
    [string]$Distribution = "Ubuntu-Backup",
    [string]$RefreshScript = "",
    [string]$LogFile = "E:\GitHub\BotManager\logs\dokploy-wsl-keepalive.log",
    [string]$MountRecoveryStateFile = "E:\GitHub\BotManager\logs\dokploy-wsl-mount-recovery-state.json",
    [string]$LanAddress = "192.168.0.99",
    [int[]]$ManagedLanPorts = @(3220, 3221, 3222),
    [ValidateRange(0, 30)]
    [int]$ListenerRecoveryDelaySeconds = 1,
    [ValidateRange(15, 3600)]
    [int]$PortProxyHealthIntervalSeconds = 60,
    [ValidatePattern('^/mnt/[A-Za-z0-9._/-]+$')]
    [string]$CriticalWslMountPath = "/mnt/e/GitHub/RukalunPage",
    [ValidateRange(1, 10)]
    [int]$RequiredStaleMountFailures = 2,
    [ValidateRange(60, 86400)]
    [int]$MountRecoveryCooldownSeconds = 900,
    [ValidateRange(1, 300)]
    [int]$MountRecoveryDelaySeconds = 10,
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

function Set-WslMountRecoveryAttempt {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$StateFile,
        [Parameter(Mandatory)][string]$Distribution,
        [Parameter(Mandatory)][DateTimeOffset]$AttemptAt
    )

    $stateDirectory = Split-Path -Parent $StateFile
    if ([string]::IsNullOrWhiteSpace($stateDirectory)) {
        throw "WSL mount recovery state directory is required."
    }

    New-Item -ItemType Directory -Force -Path $stateDirectory | Out-Null
    $temporaryStateFile = "$StateFile.tmp"
    try {
        $payload = [pscustomobject]@{
            distribution = $Distribution
            lastAttemptAt = $AttemptAt.ToString("o")
        } | ConvertTo-Json -Compress
        Set-Content -LiteralPath $temporaryStateFile -Value $payload -Encoding utf8
        Move-Item -LiteralPath $temporaryStateFile -Destination $StateFile -Force
    }
    finally {
        if (Test-Path -LiteralPath $temporaryStateFile) {
            Remove-Item -LiteralPath $temporaryStateFile -Force
        }
    }
}

function Get-WslMountRecoveryAttempt {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$StateFile)

    if (-not (Test-Path -LiteralPath $StateFile)) {
        return $null
    }

    $state = Get-Content -Raw -LiteralPath $StateFile | ConvertFrom-Json
    $lastAttemptAt = [string]$state.lastAttemptAt
    if ([string]::IsNullOrWhiteSpace($lastAttemptAt)) {
        throw "WSL mount recovery state does not contain lastAttemptAt."
    }

    return [DateTimeOffset]::Parse(
        $lastAttemptAt,
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::RoundtripKind
    )
}

function New-WslDockerKeepaliveCommand {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidatePattern('^/mnt/[A-Za-z0-9._/-]+$')]
        [string]$CriticalMountPath,
        [Parameter(Mandatory)][ValidateRange(15, 3600)]
        [int]$HealthIntervalSeconds
    )

    $quotedMountPath = "'{0}'" -f $CriticalMountPath
    $innerStatCommand = 'pid1_stat_error="$(LC_ALL=C stat -- "$1" 2>&1)" || ' +
        '{ printf "__PID1_STAT_ERROR__%s" "$pid1_stat_error"; exit 86; }'
    $pid1MountCheck = ('pid1_mount_error="$(nsenter -t 1 -m -- sh -c ''{0}'' sh {1} 2>&1)"; ' +
        'pid1_mount_exit=$?; if [ "$pid1_mount_exit" -ne 0 ]; then ' +
        'case "$pid1_mount_error" in __PID1_STAT_ERROR__stat:*": Invalid argument") exit 86 ;; ' +
        '*) exit 88 ;; esac; fi') -f $innerStatCommand, $quotedMountPath

    return @(
        "systemctl start docker && systemctl is-active --quiet docker || exit 1"
        "stat -- $quotedMountPath >/dev/null 2>&1 || exit 87"
        $pid1MountCheck
        "sleep $HealthIntervalSeconds"
    ) -join "; "
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

function Invoke-WslMountNamespaceRecovery {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Distribution,
        [Parameter(Mandatory)][ValidateRange(1, 100)]
        [int]$ConsecutiveFailureCount,
        [ValidateRange(1, 10)]
        [int]$RequiredConsecutiveFailures = 2,
        [Nullable[DateTimeOffset]]$LastRecoveryAt = $null,
        [DateTimeOffset]$Now = [DateTimeOffset]::Now,
        [ValidateRange(60, 86400)]
        [int]$RecoveryCooldownSeconds = 900,
        [ValidateRange(1, 300)]
        [int]$RecoveryDelaySeconds = 10,
        [scriptblock]$PersistRecoveryAttempt = {
            param($DistributionName, $AttemptAt)
            Set-WslMountRecoveryAttempt -StateFile $MountRecoveryStateFile `
                -Distribution $DistributionName -AttemptAt $AttemptAt
        },
        [scriptblock]$TerminateDistribution = {
            param($DistributionName)
            & wsl.exe --terminate $DistributionName
            if ($LASTEXITCODE -ne 0) {
                throw "Could not terminate WSL distribution."
            }
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
        }
    )

    if ($ConsecutiveFailureCount -lt $RequiredConsecutiveFailures) {
        & $LogAction ("WSL mount namespace recovery pending failures={0}/{1}" -f `
                $ConsecutiveFailureCount, $RequiredConsecutiveFailures)
        return [pscustomobject]@{
            Status = "pending"
            Action = "none"
        }
    }

    if ($null -ne $LastRecoveryAt) {
        $secondsSinceLastRecovery = ($Now - [DateTimeOffset]$LastRecoveryAt).TotalSeconds
        if ($secondsSinceLastRecovery -lt $RecoveryCooldownSeconds) {
            $remainingSeconds = [Math]::Ceiling($RecoveryCooldownSeconds - $secondsSinceLastRecovery)
            & $LogAction ("WSL mount namespace recovery cooldown remainingSeconds={0}" -f $remainingSeconds)
            return [pscustomobject]@{
                Status = "cooldown"
                Action = "none"
            }
        }
    }

    $recoveryAction = "none"
    try {
        & $LogAction ("WSL mount namespace stale; terminating distribution={0}" -f $Distribution)
        & $PersistRecoveryAttempt $Distribution $Now
        $recoveryAction = "terminate_distribution"
        & $TerminateDistribution $Distribution
        & $SleepAction $RecoveryDelaySeconds
        & $LogAction ("WSL mount namespace terminate result=success distribution={0}" -f $Distribution)
        return [pscustomobject]@{
            Status = "terminated"
            Action = "terminate_distribution"
        }
    }
    catch {
        try {
            & $LogAction ("WSL mount namespace recovery result=failed distribution={0}" -f $Distribution)
        }
        catch {
            # Recovery logging must never stop the WSL/Docker keepalive loop.
        }
        return [pscustomobject]@{
            Status = "failed"
            Action = $recoveryAction
        }
    }
}

function Get-WslKeepaliveLoopTransition {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][int]$ExitCode,
        [ValidateSet("none", "pending", "terminated", "failed", "cooldown")]
        [string]$RecoveryStatus = "none",
        [bool]$MountRecoveryAwaitingConfirmation = $false,
        [Parameter(Mandatory)][ValidateRange(15, 3600)]
        [int]$PortProxyHealthIntervalSeconds,
        [Parameter(Mandatory)][ValidateRange(1, 300)]
        [int]$RestartDelaySeconds
    )

    $transition = [ordered]@{
        RetryDelaySeconds      = $RestartDelaySeconds
        ResetFailureCount      = $true
        AwaitingConfirmation   = $MountRecoveryAwaitingConfirmation
        ConfirmedRecovery      = $false
        RememberRecoveryAttempt = $false
        FailureReason          = "process_failure"
    }

    if ($ExitCode -eq 0) {
        $transition.RetryDelaySeconds = 0
        $transition.AwaitingConfirmation = $false
        $transition.ConfirmedRecovery = $MountRecoveryAwaitingConfirmation
        $transition.FailureReason = "healthy"
        return [pscustomobject]$transition
    }

    if ($ExitCode -eq 86) {
        $transition.FailureReason = "stale_mount"
        $transition.RetryDelaySeconds = $PortProxyHealthIntervalSeconds
        switch ($RecoveryStatus) {
            "pending" {
                $transition.ResetFailureCount = $false
            }
            "terminated" {
                $transition.RetryDelaySeconds = 0
                $transition.AwaitingConfirmation = $true
                $transition.RememberRecoveryAttempt = $true
            }
            "failed" {
                $transition.AwaitingConfirmation = $false
                $transition.RememberRecoveryAttempt = $true
            }
            "cooldown" {
                $transition.AwaitingConfirmation = $false
            }
            default {
                throw "A mount recovery status is required for exit code 86."
            }
        }
        return [pscustomobject]$transition
    }

    if ($ExitCode -eq 87) {
        $transition.RetryDelaySeconds = $PortProxyHealthIntervalSeconds
        $transition.AwaitingConfirmation = $false
        $transition.FailureReason = "mount_source_unavailable"
    }
    elseif ($ExitCode -eq 88) {
        $transition.RetryDelaySeconds = $PortProxyHealthIntervalSeconds
        $transition.AwaitingConfirmation = $false
        $transition.FailureReason = "pid1_probe_failed"
    }

    return [pscustomobject]$transition
}

function Start-WslDokployKeepalive {
    Write-Log "keepalive start"
    $refreshRequired = $true
    $keepaliveAnnounced = $false
    $staleMountFailureCount = 0
    $mountRecoveryAwaitingConfirmation = $false
    try {
        $lastMountRecoveryAt = Get-WslMountRecoveryAttempt -StateFile $MountRecoveryStateFile
    }
    catch {
        $lastMountRecoveryAt = [DateTimeOffset]::Now
        Write-Log "WSL mount recovery state load failed; cooldown started"
    }
    $wslKeepaliveCommand = New-WslDockerKeepaliveCommand `
        -CriticalMountPath $CriticalWslMountPath `
        -HealthIntervalSeconds $PortProxyHealthIntervalSeconds

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
            & wsl.exe -d $Distribution -u root -- bash -lc $wslKeepaliveCommand
            $exitCode = $LASTEXITCODE
        }
        catch {
            $exitCode = 1
        }

        if ($exitCode -eq 0) {
            $transition = Get-WslKeepaliveLoopTransition `
                -ExitCode $exitCode `
                -MountRecoveryAwaitingConfirmation $mountRecoveryAwaitingConfirmation `
                -PortProxyHealthIntervalSeconds $PortProxyHealthIntervalSeconds `
                -RestartDelaySeconds $RestartDelaySeconds
            if ($transition.ConfirmedRecovery) {
                Write-Log "WSL mount namespace recovery result=success distribution=$Distribution"
            }
            $staleMountFailureCount = 0
            $mountRecoveryAwaitingConfirmation = $transition.AwaitingConfirmation
            continue
        }

        $recovery = $null
        $recoveryStartedAt = $null
        if ($exitCode -eq 86) {
            $staleMountFailureCount += 1
            $recoveryStartedAt = [DateTimeOffset]::Now
            $recovery = Invoke-WslMountNamespaceRecovery `
                -Distribution $Distribution `
                -ConsecutiveFailureCount $staleMountFailureCount `
                -RequiredConsecutiveFailures $RequiredStaleMountFailures `
                -LastRecoveryAt $lastMountRecoveryAt `
                -Now $recoveryStartedAt `
                -RecoveryCooldownSeconds $MountRecoveryCooldownSeconds `
                -RecoveryDelaySeconds $MountRecoveryDelaySeconds
        }
        elseif ($exitCode -eq 87) {
            Write-Log "critical WSL mount source unavailable; waiting without distribution restart path=$CriticalWslMountPath"
        }
        elseif ($exitCode -eq 88) {
            Write-Log "WSL PID 1 mount probe failed; waiting without distribution restart path=$CriticalWslMountPath"
        }

        if ($null -ne $recovery) {
            $transition = Get-WslKeepaliveLoopTransition `
                -ExitCode $exitCode `
                -RecoveryStatus $recovery.Status `
                -MountRecoveryAwaitingConfirmation $mountRecoveryAwaitingConfirmation `
                -PortProxyHealthIntervalSeconds $PortProxyHealthIntervalSeconds `
                -RestartDelaySeconds $RestartDelaySeconds
        }
        else {
            $transition = Get-WslKeepaliveLoopTransition `
                -ExitCode $exitCode `
                -MountRecoveryAwaitingConfirmation $mountRecoveryAwaitingConfirmation `
                -PortProxyHealthIntervalSeconds $PortProxyHealthIntervalSeconds `
                -RestartDelaySeconds $RestartDelaySeconds
        }

        if ($transition.RememberRecoveryAttempt -and $null -ne $recoveryStartedAt) {
            $lastMountRecoveryAt = $recoveryStartedAt
        }
        if ($transition.ResetFailureCount) {
            $staleMountFailureCount = 0
        }
        $mountRecoveryAwaitingConfirmation = $transition.AwaitingConfirmation

        $refreshRequired = $true
        $keepaliveAnnounced = $false
        Write-Log "WSL keepalive exited: exitCode=$exitCode; retrying"
        Start-Sleep -Seconds $transition.RetryDelaySeconds
    }
}

if ($MyInvocation.InvocationName -ne ".") {
    Start-WslDokployKeepalive
}
