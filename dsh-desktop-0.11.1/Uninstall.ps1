# Uninstall the SSH device switcher patch. Requires node on PATH.
# Works in Windows PowerShell 5.1 and PowerShell 7.
param(
    [Parameter(Mandatory = $true)][string]$InstallDir
)
$ErrorActionPreference = 'Stop'
Get-Command node -ErrorAction Stop | Out-Null
& node (Join-Path $PSScriptRoot 'install.mjs') uninstall $InstallDir
if ($LASTEXITCODE -ne 0) { throw '补丁卸载失败；请查看上方错误，并保留备份。' }
