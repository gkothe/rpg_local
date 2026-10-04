# Windows PDF and speech runtime

Python conversion and dictation run on the PC. The Android browser sends the recording to that PC; it does not run Whisper itself. Neither OCR nor transcription needs an API key. Whisper model weights are downloaded once during setup; inference uses only those local files. The resulting editable text still consumes normal GM input tokens when you press Send.

Use Python 3.12 and a local directory outside the checkout and cloud-synced folders. From the repository root:

On Windows, the easy dictation setup is to double-click **`setup-voice.cmd`** in the repository root. Install [Python 3.12 for Windows](https://www.python.org/downloads/windows/) with its `py` launcher first. Setup creates an isolated runtime under `%LOCALAPPDATA%\LocalRPG\runtime`, installs the locked Python dependencies, downloads the multilingual `base` model once, and verifies that it loads offline. The first run needs internet and some disk space; subsequent runs reuse the saved runtime/model.

After setup, stop the running app with Ctrl+C and run `start.cmd` again, then refresh the browser. **Refresh alone cannot update the running backend's environment.** The launcher loads the saved speech settings automatically. Record, stop, review the text and press Send. On this PC, `http://127.0.0.1:4100` supports microphone permission; on Android, use the trusted HTTPS instructions in [LAN setup](lan-setup.md).

Runtime paths are saved for the current Windows account in `%LOCALAPPDATA%\LocalRPG\runtime.json`, outside Git. Database settings remain separate and unchanged. Explicit `RPG_PYTHON_BIN`, `RPG_WHISPER_MODEL_PATH` and `RPG_WHISPER_DEVICE` environment variables take precedence over saved settings. Launching the backend directly with npm bypasses this Windows settings loader; use `start.cmd`, or set these variables yourself.

For an existing local installation, run this from PowerShell using your own paths:

```powershell
.\setup-voice.ps1 -PythonBin 'C:\YOUR_RUNTIME\venv\Scripts\python.exe' -ModelPath 'C:\YOUR_RUNTIME\whisper-base' -Offline
```

`-Offline` prevents installation and model download, and verifies the existing dependencies and model. To test an existing recording locally, add `-TestAudio 'C:\YOUR_FIXTURES\speech.wav'`; this prints the transcription, so use non-private test speech. To create a different runtime, pass `-RuntimeDirectory 'C:\YOUR_RUNTIME'` without `-Offline`. Keep runtimes and models outside the repository. If an existing installation has missing dependencies, choose a new runtime directory to rebuild it.

For manual setup or PDF OCR configuration, continue below:

```powershell
$runtime = Join-Path $env:LOCALAPPDATA 'LocalRpgRuntime'
python -m venv "$runtime\venv"
$python = "$runtime\venv\Scripts\python.exe"
& $python -m pip install -r rpg_be_local/python/requirements-lock.txt
& $python -m pip check
$env:RPG_PYTHON_BIN = $python
```

The lock records the Windows/Python 3.12 versions used for real tests. Other platforms may need the bounded `requirements.txt` instead. PyAV must remain below version 17: Faster-Whisper 1.2 uses an argument removed from newer PyAV versions.

Install [Tesseract for Windows](https://tesseract-ocr.github.io/tessdoc/Installation.html) with English (`eng`) and Portuguese (`por`) trained data. If it is not on PATH, set the executable explicitly:

```powershell
$env:RPG_TESSERACT_BIN = 'C:\Program Files\Tesseract-OCR\tesseract.exe'
& $env:RPG_TESSERACT_BIN --list-langs
```

Both language packs must appear. Native pages use MarkItDown; scanned pages use PDFium rendering and Tesseract. Successful uploads are usable immediately. You can optionally inspect and correct extracted text, particularly tables, columns and dice notation. Uploads are limited to 20 MiB, 300 pages and 120 seconds of processing.

Download the multilingual speech model explicitly (internet required for this setup step):

```powershell
& $python rpg_be_local/python/download_speech_model.py "$runtime\whisper-base"
$env:RPG_WHISPER_MODEL_PATH = "$runtime\whisper-base"
$env:RPG_WHISPER_DEVICE = 'cpu'
```

`base` was tested on Windows with CPU/int8 inference. `tiny` is faster and `small` needs more resources; this checkout does not claim measured accuracy for them. Keep the complete model directory, including `model.bin` and tokenizer/configuration files. Restart the backend with these environment variables; its diagnostics report missing dependencies or model files. Manually assigned environment variables apply to the current PowerShell session; `setup-voice.cmd` persists the paths for the Windows launcher. This app does not automatically load `.env` files.

Record, stop, inspect/edit the transcription, then press Send. Transcription never submits a GM turn automatically. Recordings are limited to 120 seconds and deleted after processing. Missing runtime or unrecognized speech leaves typing available.

Read-aloud uses a browser voice marked as installed/local. It speaks existing committed GM text, with no new AI request. Voice availability differs between Windows and Android; install an Android speech voice if none is available. See [Android LAN setup](lan-setup.md) for trusted HTTPS required by phone microphone access.

## Runtime verification

The synthetic native/scanned/mixed English/Portuguese PDF suite and actual local speech model tests are separate from npm's default offline tests:

```powershell
& $python -m pip install -r rpg_be_local/python/requirements-test.txt
$env:RPG_AUDIO_TEST_FILE = 'C:\YOUR_FIXTURES\synthetic-speech.wav'
& $python -m unittest discover -s rpg_be_local/python/tests
$env:RPG_RUNTIME_TESTS = '1'
npm test --workspace rpg-be-local
```

Supply a non-private spoken fixture for the opt-in speech tests. Ordinary tests do not download models, record your microphone or call a live GM. Real tests verified mixed PDF OCR, Portuguese accents, blank/corrupt rejection and speech-to-editable-composer; they do not establish perfect rulebook layout recognition or physical Android microphone compatibility.
