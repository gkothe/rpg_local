$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
try {
    if (-not (Test-Path 'node_modules\pg')) { throw 'Run npm install in this folder first.' }
    Write-Host 'Creates the isolated rpg_local_test database for automated tests (never your campaign data).'
    $port = Read-Host 'PostgreSQL port [5432]'
    if (-not $port) { $port = '5432' }
    if ($port -notmatch '^\d+$' -or [int]$port -lt 1 -or [int]$port -gt 65535) { throw 'Invalid port.' }
    $admin = Read-Host 'PostgreSQL administrator username [postgres]'
    if (-not $admin) { $admin = 'postgres' }
    $secret = Read-Host 'PostgreSQL administrator password' -AsSecureString
    $credential = New-Object System.Management.Automation.PSCredential($admin, $secret)
    $payload = @{ port = [int]$port; user = $admin; password = $credential.GetNetworkCredential().Password } | ConvertTo-Json -Compress
    $payload | & node.exe scripts/provision-test-database.mjs
    $payload = $null
    if ($LASTEXITCODE -ne 0) { throw 'Provisioning failed. No administrator credentials were saved.' }
} catch {
    Write-Host ('Setup failed: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
