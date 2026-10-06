$ErrorActionPreference = 'Stop'
$projectEnvPath = Join-Path (Split-Path $PSScriptRoot -Parent) '.env'
if (Test-Path -LiteralPath $projectEnvPath) {
    $projectEnvJson = & node.exe "$PSScriptRoot\project-env.mjs" read
    if ($LASTEXITCODE -ne 0) { throw 'Could not load the project .env file.' }
    $projectEnvSettings = $projectEnvJson | ConvertFrom-Json
    foreach ($property in $projectEnvSettings.PSObject.Properties) {
        if ($null -eq [Environment]::GetEnvironmentVariable($property.Name, 'Process')) {
            [Environment]::SetEnvironmentVariable($property.Name, [string]$property.Value, 'Process')
        }
    }
    $projectEnvJson = $null
    $projectEnvSettings = $null
}
$lanSettingsPath = Join-Path $env:LOCALAPPDATA 'LocalRPG\lan.json'
if (-not $env:RPG_LAN_HOST -and (Test-Path -LiteralPath $lanSettingsPath)) {
    $lanSettings = Get-Content -LiteralPath $lanSettingsPath -Raw | ConvertFrom-Json
    if ($lanSettings.host) { $env:RPG_LAN_HOST = [string]$lanSettings.host }
}
$runtimeSettingsPath = Join-Path $env:LOCALAPPDATA 'LocalRPG\runtime.json'
if (Test-Path -LiteralPath $runtimeSettingsPath) {
    $runtimeSettings = Get-Content -LiteralPath $runtimeSettingsPath -Raw | ConvertFrom-Json
    if (-not $env:RPG_PYTHON_BIN -and $runtimeSettings.pythonBin) { $env:RPG_PYTHON_BIN = [string]$runtimeSettings.pythonBin }
    if (-not $env:RPG_WHISPER_MODEL_PATH -and $runtimeSettings.whisperModelPath) { $env:RPG_WHISPER_MODEL_PATH = [string]$runtimeSettings.whisperModelPath }
    if (-not $env:RPG_WHISPER_DEVICE -and $runtimeSettings.whisperDevice) { $env:RPG_WHISPER_DEVICE = [string]$runtimeSettings.whisperDevice }
}
