[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$Distro = "Ubuntu-Backup"
$Ports = @(80, 443, 3000, 11434, 8888, 5000)
$LanAddress = "192.168.0.99"
$LanSubnet = "192.168.0.0/24"
$FirewallRuleName = "Dokploy WSL LAN Access"
$LanUiPorts = @(3220, 3221)
$LanUiFirewallRuleName = "twitchRaid LAN Web UIs"

Start-Service iphlpsvc -ErrorAction SilentlyContinue

$wslIpOutput = & wsl.exe -d $Distro -u root -- bash -lc "systemctl is-active --quiet docker || systemctl start docker; hostname -I"
$WslIp = @(
    ($wslIpOutput -join " ") -split "\s+" |
        Where-Object { $_ -match '^\d{1,3}(?:\.\d{1,3}){3}$' }
) | Select-Object -First 1

if (-not $WslIp) {
    throw "Could not determine the WSL IPv4 address."
}

foreach ($Port in $Ports) {
    & netsh.exe interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$Port | Out-Null
    & netsh.exe interface portproxy delete v4tov4 listenaddress=$LanAddress listenport=$Port | Out-Null
    & netsh.exe interface portproxy add v4tov4 listenaddress=$LanAddress listenport=$Port connectaddress=$WslIp connectport=$Port | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Could not refresh a Dokploy WSL portproxy mapping."
    }
}

Get-NetFirewallRule -DisplayName $FirewallRuleName -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule
New-NetFirewallRule `
    -DisplayName $FirewallRuleName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalAddress $LanAddress `
    -LocalPort $Ports `
    -RemoteAddress $LanSubnet `
    -Profile Any |
    Out-Null

foreach ($Port in $LanUiPorts) {
    & netsh.exe interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$Port | Out-Null
    & netsh.exe interface portproxy delete v4tov4 listenaddress=$LanAddress listenport=$Port | Out-Null
    & netsh.exe interface portproxy add v4tov4 listenaddress=$LanAddress listenport=$Port connectaddress=$WslIp connectport=$Port | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Could not refresh a twitchRaid LAN Web UI portproxy mapping."
    }
    Get-NetFirewallRule -DisplayName "twitchRaid LAN UI ${Port}" -ErrorAction SilentlyContinue |
        Remove-NetFirewallRule
}

Get-NetFirewallRule -DisplayName $LanUiFirewallRuleName -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule
New-NetFirewallRule `
    -DisplayName $LanUiFirewallRuleName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalAddress $LanAddress `
    -LocalPort $LanUiPorts `
    -RemoteAddress $LanSubnet `
    -Profile Any |
    Out-Null

[pscustomobject]@{
    Distro          = $Distro
    WslIp           = $WslIp
    DokployPorts    = ($Ports -join ",")
    LanUiPorts      = ($LanUiPorts -join ",")
    FirewallRule    = $FirewallRuleName
    LanUiFirewall   = $LanUiFirewallRuleName
}
