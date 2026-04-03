#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Configure this Windows machine to resolve *.ai.on via the Aionima server.

.DESCRIPTION
    Prepends the Aionima DNS server IP to the active network adapter's DNS settings
    so that *.ai.on names resolve via dnsmasq on the Aionima server.

.PARAMETER AionimaIP
    IP address of the Aionima server. Defaults to the baked-in value from the API.

.EXAMPLE
    # Download and run:
    Invoke-WebRequest http://ai.on:3100/api/hosting/client-setup/windows -OutFile client-dns-setup.ps1
    .\client-dns-setup.ps1

    # Override IP:
    .\client-dns-setup.ps1 -AionimaIP 10.0.0.5
#>

param(
    [string]$AionimaIP = "__AIONIMA_IP__",
    [string]$BaseDomain = "__BASE_DOMAIN__"
)

$ErrorActionPreference = "Stop"

Write-Host "==> Configuring DNS to resolve *.$BaseDomain via $AionimaIP" -ForegroundColor Cyan

# --------------------------------------------------------------------------
# Find the active network adapter — prompt user to choose
# --------------------------------------------------------------------------

# Only consider adapters that are up and have an IPv4 address
$adapters = @(Get-NetAdapter | Where-Object { $_.Status -eq "Up" } | Where-Object {
    $ip = (Get-NetIPAddress -InterfaceIndex $_.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue)
    $ip -ne $null
} | Sort-Object -Property InterfaceMetric)

if ($adapters.Count -eq 0) {
    Write-Error "No active network adapters with IPv4 addresses found."
    exit 1
}

if ($adapters.Count -eq 1) {
    $ip = (Get-NetIPAddress -InterfaceIndex $adapters[0].InterfaceIndex -AddressFamily IPv4).IPAddress | Select-Object -First 1
    $adapter = $adapters[0]
    Write-Host "    Active adapter: $($adapter.Name) ($($adapter.InterfaceDescription)) - $ip"
} else {
    Write-Host ""
    Write-Host "    Multiple active adapters found:" -ForegroundColor Yellow
    for ($i = 0; $i -lt $adapters.Count; $i++) {
        $a = $adapters[$i]
        $ip = (Get-NetIPAddress -InterfaceIndex $a.InterfaceIndex -AddressFamily IPv4).IPAddress -join ", "
        $dns = (Get-DnsClientServerAddress -InterfaceIndex $a.InterfaceIndex -AddressFamily IPv4).ServerAddresses -join ", "
        if (-not $dns) { $dns = "(no DNS)" }
        Write-Host "      [$($i + 1)] $($a.Name) - $($a.InterfaceDescription)"
        Write-Host "           IP: $ip  DNS: $dns"
    }
    Write-Host ""
    do {
        $choice = Read-Host "    Select adapter [1-$($adapters.Count)]"
    } while ($choice -notmatch '^\d+$' -or [int]$choice -lt 1 -or [int]$choice -gt $adapters.Count)
    $adapter = $adapters[[int]$choice - 1]
    Write-Host "    Selected: $($adapter.Name) ($($adapter.InterfaceDescription))"
}

# --------------------------------------------------------------------------
# Get current DNS servers and prepend Aionima IP
# --------------------------------------------------------------------------

$currentDns = (Get-DnsClientServerAddress -InterfaceIndex $adapter.InterfaceIndex -AddressFamily IPv4).ServerAddresses

if ($currentDns -contains $AionimaIP) {
    Write-Host "    DNS already includes $AionimaIP - nothing to do." -ForegroundColor Green
} else {
    $newDns = @($AionimaIP) + @($currentDns | Where-Object { $_ -ne $AionimaIP })
    Set-DnsClientServerAddress -InterfaceIndex $adapter.InterfaceIndex -ServerAddresses $newDns
    Write-Host "    DNS servers set: $($newDns -join ', ')"
}

# --------------------------------------------------------------------------
# Flush DNS cache
# --------------------------------------------------------------------------

Clear-DnsClientCache
Write-Host "    DNS cache flushed."

# --------------------------------------------------------------------------
# Verify
# --------------------------------------------------------------------------

Write-Host ""
Write-Host "==> Verifying: Resolve-DnsName test.$BaseDomain -Server $AionimaIP" -ForegroundColor Cyan

try {
    $result = Resolve-DnsName -Name "test.$BaseDomain" -Server $AionimaIP -ErrorAction Stop
    Write-Host "    OK - test.$BaseDomain resolves to $($result.IPAddress)" -ForegroundColor Green
} catch {
    Write-Host "    WARNING: No response from $AionimaIP for test.$BaseDomain." -ForegroundColor Yellow
    Write-Host "    The dnsmasq server may not be running or configured yet."
}

# --------------------------------------------------------------------------
# Install Caddy internal CA certificate (for HTTPS trust)
# --------------------------------------------------------------------------

Write-Host ""
Write-Host "==> Installing Aionima CA certificate for HTTPS trust" -ForegroundColor Cyan

$caUrl = "http://${AionimaIP}:3100/api/hosting/ca-cert"
$caFile = "$env:TEMP\aionima-ca.crt"

try {
    Invoke-WebRequest $caUrl -OutFile $caFile -ErrorAction Stop
    # Windows trust store — Chrome and Edge respect this automatically
    Import-Certificate -FilePath $caFile -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
    Write-Host "    CA certificate added to Trusted Root Certification Authorities." -ForegroundColor Green
    Write-Host "    Chrome and Edge will trust *.${BaseDomain} immediately." -ForegroundColor Green

    # Firefox uses its own trust store — try to add via certutil if available
    $firefoxProfiles = Get-ChildItem "$env:APPDATA\Mozilla\Firefox\Profiles\*.default*" -Directory -ErrorAction SilentlyContinue
    $certutilPath = Get-ChildItem "C:\Program Files\Mozilla Firefox\certutil.exe", "C:\Program Files (x86)\Mozilla Firefox\certutil.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($firefoxProfiles -and $certutilPath) {
        foreach ($profile in $firefoxProfiles) {
            & $certutilPath.FullName -A -n "Aionima Local CA" -t "C,," -i $caFile -d $profile.FullName 2>$null
            if ($?) { Write-Host "    CA added to Firefox profile: $($profile.Name)" -ForegroundColor Green }
        }
    } elseif ($firefoxProfiles) {
        Write-Host "    NOTE: Firefox uses its own trust store. Import $caUrl manually in about:preferences#privacy > Certificates." -ForegroundColor Yellow
    }

    Remove-Item $caFile -Force
} catch {
    Write-Host "    WARNING: Could not download or install CA cert from $caUrl." -ForegroundColor Yellow
    Write-Host "    HTTPS sites will show browser warnings until the CA is trusted."
    Write-Host "    Retry later: Invoke-WebRequest $caUrl -OutFile aionima-ca.crt"
}

Write-Host ""
Write-Host "Done. This machine should now resolve *.$BaseDomain via $AionimaIP." -ForegroundColor Cyan
Write-Host "      HTTPS sites at https://*.$BaseDomain should be trusted." -ForegroundColor Cyan
