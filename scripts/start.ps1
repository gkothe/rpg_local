param([ValidateSet('dev', 'run')][string]$Mode = 'dev')
$ErrorActionPreference = 'Stop'
try {
    Set-Location (Split-Path $PSScriptRoot -Parent)
    . "$PSScriptRoot\local-settings.ps1"
    if (-not $PSBoundParameters.ContainsKey('Mode') -and $env:RPG_LAN_HOST) { $Mode = 'run' }
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22.13 or newer first.' }
    & node.exe -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major<22||(major===22&&minor<13)?1:0)"
    if ($LASTEXITCODE -ne 0) { throw 'Node.js 22.13 or newer is required.' }
    if (-not (Test-Path 'node_modules\.bin\tsc.cmd')) { throw 'Run npm install in this folder first.' }
    if (-not $env:RPG_DATABASE_URL) { Write-Host 'Run setup-database.cmd before creating a campaign.' }
    if ($Mode -eq 'dev') {
        Write-Host 'Automatic reload enabled: frontend updates live; backend restarts on source changes.'
        Write-Host 'Open http://127.0.0.1:5174 - press Ctrl+C to stop.'
        & npm.cmd run dev
    } else {
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
        $port = if ($env:RPG_PORT) { $env:RPG_PORT } else { '4100' }
        Write-Host ("Open http://127.0.0.1:" + $port + " - press Ctrl+C to stop.")
        if ($env:RPG_LAN_HOST) { Write-Host ("Other devices: http://" + $env:RPG_LAN_HOST + ":" + $port) }
        & npm.cmd start
    }
    exit $LASTEXITCODE
} catch {
    Write-Host ('Startup failed: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
