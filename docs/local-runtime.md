# Windows PDF and speech runtime

Python conversion and dictation run on the PC. The Android browser sends the recording to that PC; it does not run Whisper itself. Neither OCR nor transcription needs an API key. Whisper model weights are downloaded once during setup; inference uses only those local files. The resulting editable text still consumes normal GM input tokens when you press Send.

Use Python 3.12 and a local directory outside the checkout and cloud-synced folders. From the repository root:

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

Both language packs must appear. Native pages use MarkItDown; scanned pages use PDFium rendering and Tesseract. Review and correct extracted text before confirming it, particularly tables, columns and dice notation. Uploads are limited to 20 MiB, 300 pages and 120 seconds of processing.

Download the multilingual speech model explicitly (internet required for this setup step):

```powershell
& $python rpg_be_local/python/download_speech_model.py "$runtime\whisper-base"
$env:RPG_WHISPER_MODEL_PATH = "$runtime\whisper-base"
$env:RPG_WHISPER_DEVICE = 'cpu'
```

`base` was tested on Windows with CPU/int8 inference. `tiny` is faster and `small` needs more resources; this checkout does not claim measured accuracy for them. Keep the complete model directory, including `model.bin` and tokenizer/configuration files. Restart the backend with these environment variables; its diagnostics report missing dependencies or model files. Environment variables apply to the current PowerShell session; this app does not automatically load `.env` files.

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
