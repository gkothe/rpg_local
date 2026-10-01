param(
    [string]$RuntimeDirectory = (Join-Path $env:LOCALAPPDATA 'LocalRPG\runtime'),
    [string]$PythonBin,
    [string]$ModelPath,
    [switch]$Offline,
    [string]$TestAudio
)
$ErrorActionPreference = 'Stop'
try {
    Set-Location $PSScriptRoot
    $savedSettingsPath = Join-Path $env:LOCALAPPDATA 'LocalRPG\runtime.json'
    if (-not $PSBoundParameters.ContainsKey('RuntimeDirectory') -and -not $PythonBin -and -not $ModelPath -and (Test-Path -LiteralPath $savedSettingsPath)) {
        $savedSettings = Get-Content -LiteralPath $savedSettingsPath -Raw | ConvertFrom-Json
        if ((Test-Path -LiteralPath ([string]$savedSettings.pythonBin)) -and (Test-Path -LiteralPath ([string]$savedSettings.whisperModelPath))) {
            $PythonBin = [string]$savedSettings.pythonBin
            $ModelPath = [string]$savedSettings.whisperModelPath
        }
    }
    $RuntimeDirectory = [IO.Path]::GetFullPath($RuntimeDirectory)
    $repoPath = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') + '\'
    if (($RuntimeDirectory.TrimEnd('\') + '\').StartsWith($repoPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Keep the runtime outside the repository. Use the default LocalAppData directory.'
    }
    if (-not $PythonBin) {
        $PythonBin = Join-Path $RuntimeDirectory 'venv\Scripts\python.exe'
        if (-not (Test-Path -LiteralPath $PythonBin)) {
            if ($Offline) { throw 'Offline setup requires an existing Python environment with Faster-Whisper installed.' }
            if (-not (Get-Command py.exe -ErrorAction SilentlyContinue)) { throw 'Install Python 3.12 for Windows (including the py launcher), then rerun setup.' }
            New-Item -ItemType Directory -Path $RuntimeDirectory -Force | Out-Null
            & py.exe -3.12 -m venv (Join-Path $RuntimeDirectory 'venv')
            if ($LASTEXITCODE -ne 0) { throw 'Could not create the Python 3.12 environment.' }
        }
        $lockFile = Join-Path $PSScriptRoot 'rpg_be_local\python\requirements-lock.txt'
        $lockHash = (Get-FileHash -LiteralPath $lockFile -Algorithm SHA256).Hash
        $marker = Join-Path $RuntimeDirectory 'requirements.sha256'
        $installedHash = if (Test-Path -LiteralPath $marker) { (Get-Content -LiteralPath $marker -Raw).Trim() } else { '' }
        if (-not $Offline -and $installedHash -ne $lockHash) {
            Write-Host 'Installing the tested local Python runtime. This setup step needs internet.'
            & $PythonBin -m pip install -r $lockFile
            if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed.' }
            & $PythonBin -m pip check
            if ($LASTEXITCODE -ne 0) { throw 'Python dependency verification failed.' }
            Set-Content -LiteralPath $marker -Value $lockHash -Encoding ASCII
        }
    }
    $PythonBin = (Resolve-Path -LiteralPath $PythonBin).Path
    & $PythonBin -c "import faster_whisper, av; print('Local speech dependencies available.')"
    if ($LASTEXITCODE -ne 0) { throw 'Faster-Whisper or PyAV is missing. Rerun online setup with the default Python environment.' }
    if (-not $ModelPath) { $ModelPath = Join-Path $RuntimeDirectory 'whisper-base' }
    $ModelPath = [IO.Path]::GetFullPath($ModelPath)
    if (($ModelPath.TrimEnd('\') + '\').StartsWith($repoPath, [StringComparison]::OrdinalIgnoreCase)) { throw 'Keep model weights outside the repository.' }
    $modelReady = $true
    foreach ($file in @('model.bin', 'config.json', 'tokenizer.json')) {
        if (-not (Test-Path -LiteralPath (Join-Path $ModelPath $file))) { $modelReady = $false }
    }
    if (-not $modelReady) {
        if ($Offline) { throw 'The complete local Whisper model is missing. Rerun without -Offline to download it.' }
        Write-Host 'Downloading the multilingual base speech model once. No API key is needed.'
        & $PythonBin 'rpg_be_local\python\download_speech_model.py' $ModelPath
        if ($LASTEXITCODE -ne 0) { throw 'Model download failed. Rerun setup to retry.' }
    }
    $env:RPG_PYTHON_BIN = $PythonBin
    $env:RPG_WHISPER_MODEL_PATH = $ModelPath
    $env:RPG_WHISPER_DEVICE = 'cpu'
    $env:HF_HUB_OFFLINE = '1'
    Write-Host 'Checking that the speech model loads entirely from local files...'
    & $PythonBin -c "import os; from faster_whisper import WhisperModel; WhisperModel(os.environ['RPG_WHISPER_MODEL_PATH'], device='cpu', compute_type='int8', local_files_only=True); print('Offline speech model ready.')"
    if ($LASTEXITCODE -ne 0) { throw 'The local model could not load. Check the model files and Python runtime.' }
    if ($TestAudio) {
        $TestAudio = (Resolve-Path -LiteralPath $TestAudio).Path
        & $PythonBin 'rpg_be_local\python\transcribe.py' $TestAudio 'auto'
        if ($LASTEXITCODE -ne 0) { throw 'Local transcription verification failed.' }
    }
    $settingsDirectory = Join-Path $env:LOCALAPPDATA 'LocalRPG'
    New-Item -ItemType Directory -Path $settingsDirectory -Force | Out-Null
    $settingsPath = Join-Path $settingsDirectory 'runtime.json'
    @{ pythonBin = $PythonBin; whisperModelPath = $ModelPath; whisperDevice = 'cpu' } |
        ConvertTo-Json | Set-Content -LiteralPath $settingsPath -Encoding UTF8
    Write-Host 'Dictation ready. Restart start.cmd, then refresh the browser.' -ForegroundColor Green
    Write-Host 'Settings are saved outside Git for this Windows account. Transcription uses no API keys or subscription tokens.'
} catch {
    Write-Host ('Voice setup failed: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
