#Requires -Version 7.0
param([Parameter(Mandatory = $true)][string]$InstallDir)
$ErrorActionPreference = 'Stop'
Get-Command node, pwsh -ErrorAction Stop | Out-Null
& node (Join-Path $PSScriptRoot 'install.mjs') uninstall $InstallDir
if ($LASTEXITCODE -ne 0) { throw '补丁卸载失败；请查看上方错误，保留备份。' }
