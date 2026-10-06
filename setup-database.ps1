param([switch]$ConfigureExisting)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
try {
    if (-not (Test-Path 'node_modules\pg')) { throw 'Run npm install in this folder first.' }
    . "$PSScriptRoot\scripts\local-settings.ps1"
    if ($ConfigureExisting) {
        $secret = Read-Host 'Dedicated local database URL (hidden)' -AsSecureString
        $credential = New-Object System.Management.Automation.PSCredential('database', $secret)
        $env:RPG_DATABASE_URL = $credential.GetNetworkCredential().Password
    } elseif (-not $env:RPG_DATABASE_URL) {
        Write-Host 'PostgreSQL must be installed and running. This creates rpg_local and its dedicated role.'
        $port = Read-Host 'PostgreSQL port [5432]'
        if (-not $port) { $port = '5432' }
        if ($port -notmatch '^\d+$' -or [int]$port -lt 1 -or [int]$port -gt 65535) { throw 'Invalid port.' }
        $admin = Read-Host 'PostgreSQL administrator username [postgres]'
        if (-not $admin) { $admin = 'postgres' }
        $secret = Read-Host 'PostgreSQL administrator password' -AsSecureString
        $credential = New-Object System.Management.Automation.PSCredential($admin, $secret)
        $payload = @{ port = [int]$port; user = $admin; password = $credential.GetNetworkCredential().Password } | ConvertTo-Json -Compress
        $result = $payload | & node.exe scripts/provision-database.mjs
        $payload = $null
        if ($LASTEXITCODE -ne 0) { throw 'Provisioning failed. No administrator credentials were saved.' }
        $env:RPG_DATABASE_URL = ($result | ConvertFrom-Json).databaseUrl
    }
    & node.exe -e "try{const u=new URL(process.env.RPG_DATABASE_URL);if(!['postgres:','postgresql:'].includes(u.protocol)||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||['','/postgres','/template0','/template1'].includes(u.pathname))process.exit(1)}catch{process.exit(1)}"
    if ($LASTEXITCODE -ne 0) { throw 'Use a dedicated database on loopback, not postgres/template databases.' }
    & node.exe scripts/project-env.mjs save-database
    if ($LASTEXITCODE -ne 0) { throw 'Could not save the database URL to the project .env file.' }
    & npm.cmd run migrate
    if ($LASTEXITCODE -ne 0) { throw 'Migrations failed. Fix the connection and rerun setup-database.cmd.' }
    Write-Host 'Database ready. Run start.cmd (restart it if already running).' -ForegroundColor Green
} catch {
    Write-Host ('Setup failed: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
