#Requires -Version 7.0
param([Parameter(Mandatory = $true)][string]$InstallDir)
$ErrorActionPreference = 'Stop'
Get-Command node, ssh, pwsh -ErrorAction Stop | Out-Null
& node (Join-Path $PSScriptRoot 'install.mjs') install $InstallDir
if ($LASTEXITCODE -ne 0) { throw '补丁安装失败；请查看上方错误。' }
