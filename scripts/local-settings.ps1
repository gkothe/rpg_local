$ErrorActionPreference = 'Stop'
$lanSettingsPath = Join-Path $env:LOCALAPPDATA 'LocalRPG\lan.json'
if (-not $env:RPG_LAN_HOST -and (Test-Path -LiteralPath $lanSettingsPath)) {
    $lanSettings = Get-Content -LiteralPath $lanSettingsPath -Raw | ConvertFrom-Json
    if ($lanSettings.host) { $env:RPG_LAN_HOST = [string]$lanSettings.host }
}
$settingsPath = Join-Path $env:LOCALAPPDATA 'LocalRPG\database.json'
if (-not $env:RPG_DATABASE_URL -and (Test-Path -LiteralPath $settingsPath)) {
    $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
    $secret = ConvertTo-SecureString $settings.databaseUrl
    $credential = New-Object System.Management.Automation.PSCredential('database', $secret)
    $env:RPG_DATABASE_URL = $credential.GetNetworkCredential().Password
}
$runtimeSettingsPath = Join-Path $env:LOCALAPPDATA 'LocalRPG\runtime.json'
if (Test-Path -LiteralPath $runtimeSettingsPath) {
    $runtimeSettings = Get-Content -LiteralPath $runtimeSettingsPath -Raw | ConvertFrom-Json
    if (-not $env:RPG_PYTHON_BIN -and $runtimeSettings.pythonBin) { $env:RPG_PYTHON_BIN = [string]$runtimeSettings.pythonBin }
    if (-not $env:RPG_WHISPER_MODEL_PATH -and $runtimeSettings.whisperModelPath) { $env:RPG_WHISPER_MODEL_PATH = [string]$runtimeSettings.whisperModelPath }
    if (-not $env:RPG_WHISPER_DEVICE -and $runtimeSettings.whisperDevice) { $env:RPG_WHISPER_DEVICE = [string]$runtimeSettings.whisperDevice }
}
