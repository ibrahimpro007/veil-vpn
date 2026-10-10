<#
.SYNOPSIS
  Compiles windows/helper/veil_helper.dart to veil_helper.exe.

.DESCRIPTION
  Needs only the Dart SDK (ships with Flutter). CI runs this and attaches
  veil_helper.exe to GitHub Releases; tool/install_helper.ps1 installs it.

.EXAMPLE
  .\windows\build_helper.ps1
  .\windows\build_helper.ps1 -OutDir .\dist
#>
param(
  [string]$OutDir = "$PSScriptRoot\..\build\helper"
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$src = Join-Path $PSScriptRoot "helper\veil_helper.dart"
$out = Join-Path $OutDir "veil_helper.exe"
Write-Host "Compiling $src -> $out"
& dart compile exe $src -o $out
if ($LASTEXITCODE -ne 0) { throw "dart compile exe failed." }
Write-Host "Built: $out"
