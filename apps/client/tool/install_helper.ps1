#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Installs the VeilVPN Windows helper (elevated tunnel + kill-switch service).

.DESCRIPTION
  Must run as Administrator. Does the following:
  1. Installs the official WireGuard for Windows client (silent) if missing.
  2. Installs veil_helper.exe to %PROGRAMFILES%\VeilVPN\.
  3. Writes %PROGRAMDATA%\VeilVPN\helper.json with a random auth token
     (ACL: SYSTEM + Administrators full, installing user read-only).
  4. Registers the "VeilVPNHelper" scheduled task (SYSTEM, highest
     privileges): starts at boot and on demand via `schtasks /Run`.

.PARAMETER HelperExe
  Path to a prebuilt veil_helper.exe (from CI / GitHub Releases).
  If omitted, the script tries `dart compile exe` (needs the Dart SDK).

.EXAMPLE
  .\tool\install_helper.ps1 -HelperExe .\build\helper\veil_helper.exe
#>
param(
  [string]$HelperExe = ""
)

$ErrorActionPreference = "Stop"

$veilDir     = "$env:PROGRAMDATA\VeilVPN"
$installDir  = "$env:PROGRAMFILES\VeilVPN"
$taskName    = "VeilVPNHelper"
$helperPort  = 17839

Write-Host "[1/5] Preparing directories..."
New-Item -ItemType Directory -Force -Path $veilDir | Out-Null
New-Item -ItemType Directory -Force -Path $installDir | Out-Null

Write-Host "[2/5] Checking WireGuard for Windows..."
$wgExe = "$env:PROGRAMFILES\WireGuard\wireguard.exe"
if (-not (Test-Path $wgExe)) {
  Write-Host "  Downloading official WireGuard installer..."
  $installer = "$env:TEMP\wireguard-installer.exe"
  Invoke-WebRequest -Uri "https://download.wireguard.com/windows-client/wireguard-installer.exe" `
    -OutFile $installer
  Write-Host "  Installing silently..."
  Start-Process -FilePath $installer -ArgumentList "/install", "/quiet" -Wait
  Remove-Item $installer -Force -ErrorAction SilentlyContinue
  if (-not (Test-Path $wgExe)) {
    throw "WireGuard installation failed: $wgExe not found."
  }
}
Write-Host "  Found: $wgExe"

Write-Host "[3/5] Installing veil_helper.exe..."
$destExe = "$installDir\veil_helper.exe"
if ($HelperExe -ne "" -and (Test-Path $HelperExe)) {
  Copy-Item $HelperExe $destExe -Force
} else {
  $dart = Get-Command dart -ErrorAction SilentlyContinue
  if ($null -eq $dart) {
    throw "No -HelperExe given and 'dart' not on PATH. Build it with windows/build_helper.ps1 or pass -HelperExe."
  }
  $helperSrc = Join-Path $PSScriptRoot "..\windows\helper\veil_helper.dart"
  & dart compile exe $helperSrc -o $destExe
  if ($LASTEXITCODE -ne 0) { throw "dart compile exe failed." }
}
Write-Host "  Installed: $destExe"

Write-Host "[4/5] Writing helper.json (auth token)..."
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$tokenBytes = New-Object byte[] 32
$rng.GetBytes($tokenBytes)
$token = ([System.BitConverter]::ToString($tokenBytes) -replace "-", "").ToLower()
$helperJson = "$veilDir\helper.json"
@{ authToken = $token; port = $helperPort } | ConvertTo-Json | Set-Content $helperJson -Encoding UTF8

# ACL: no inheritance; SYSTEM + Administrators full; installing user read-only.
$installingUser = "$env:USERDOMAIN\$env:USERNAME"
icacls $helperJson /inheritance:r /grant:r "SYSTEM:(F)" "Administrators:(F)" "$installingUser:(R)" | Out-Null
icacls $helperJson
Write-Host "  Token provisioned. The app reads it on first run and stores it in secure storage."

Write-Host "[5/5] Registering scheduled task '$taskName'..."
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
$action    = New-ScheduledTaskAction -Execute $destExe
$trigger   = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -StartWhenAvailable `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 3

# Smoke test: TCP connect to the helper port.
$tcp = New-Object Net.Sockets.TcpClient
try {
  $tcp.Connect("127.0.0.1", $helperPort)
  Write-Host "SUCCESS: VeilVPN helper is listening on 127.0.0.1:$helperPort."
} catch {
  throw "Helper did not come up on 127.0.0.1:$helperPort. Check the '$taskName' scheduled task."
} finally {
  $tcp.Close()
}
Write-Host "Done. You can now connect from the VeilVPN app."
