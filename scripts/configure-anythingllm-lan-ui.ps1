param(
    [string]$LanAddress = "192.168.0.99",
    [string]$LanSubnet = "192.168.0.0/24",
    [int]$Port = 3220,
    [string]$WslDistribution = "Ubuntu-Backup"
)

$ErrorActionPreference = "Stop"
if ($Port -lt 1024 -or $Port -gt 65535) {
    throw "Port must be between 1024 and 65535."
}
$parsedAddress = $null
if (-not [System.Net.IPAddress]::TryParse($LanAddress, [ref]$parsedAddress)) {
    throw "LanAddress must be an IP address."
}

$wslAddresses = (& wsl.exe -d $WslDistribution -- hostname -I).Trim().Split(" ")
$wslAddress = $wslAddresses | Where-Object { $_ -match '^\d{1,3}(?:\.\d{1,3}){3}$' } | Select-Object -First 1
if (-not $wslAddress) {
    throw "Could not resolve the WSL IPv4 address."
}

$ruleName = "twitchRaid LAN UI ${Port}"
Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule `
    -DisplayName $ruleName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalAddress $LanAddress `
    -LocalPort $Port `
    -RemoteAddress $LanSubnet `
    -Profile Private | Out-Null

& netsh.exe interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$Port | Out-Null
& netsh.exe interface portproxy delete v4tov4 listenaddress=$LanAddress listenport=$Port | Out-Null
& netsh.exe interface portproxy add v4tov4 listenaddress=$LanAddress listenport=$Port connectaddress=$wslAddress connectport=$Port | Out-Null

Write-Output "twitchRaid LAN UI: http://${LanAddress}:${Port}/ (allowed source: ${LanSubnet})"
