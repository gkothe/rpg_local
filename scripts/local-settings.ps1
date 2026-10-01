$ErrorActionPreference = 'Stop'
$settingsPath = Join-Path $env:LOCALAPPDATA 'LocalRPG\database.json'
if (-not $env:RPG_DATABASE_URL -and (Test-Path -LiteralPath $settingsPath)) {
    $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
    $secret = ConvertTo-SecureString $settings.databaseUrl
    $credential = New-Object System.Management.Automation.PSCredential('database', $secret)
    $env:RPG_DATABASE_URL = $credential.GetNetworkCredential().Password
}
