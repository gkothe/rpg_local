# Windows installation

Use native Windows and a local writable checkout, such as C:\Projects\rpg_local. Run the repository commands from its root. Windows is the tested platform; PostgreSQL 18 and Python 3.12 are the versions used for database and runtime checks.

The project scripts configure their own database and Python runtime. They do not install Git, Node.js, PostgreSQL binaries, Tesseract or an AI CLI.

## Requirements

| Dependency                            | Needed for                     | Source                                                                                              |
| ------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------- |
| Git for Windows                       | Clone and update               | [Git](https://git-scm.com/download/win)                                                             |
| Node.js 22.13+ with npm               | App, builds and migrations     | [Node.js](https://nodejs.org/en/download)                                                           |
| PostgreSQL                            | Campaign storage               | [Official Windows downloads](https://www.postgresql.org/download/windows/)                          |
| Claude Code, Codex or Antigravity CLI | GM turns and character parsing | [CLI setup below](#install-an-ai-cli)                                                               |
| Gemini API or OpenRouter key          | GM turns, alternative to a CLI | [API setup below](#optional-gemini-api-and-openrouter)                                              |
| Python 3.12 with the py launcher      | PDFs and dictation             | [Python Windows downloads](https://www.python.org/downloads/windows/)                               |
| Tesseract with language data          | Scanned PDFs                   | [Tesseract Windows instructions](https://tesseract-ocr.github.io/tessdoc/Installation.html#windows) |
| Local Faster-Whisper model            | Dictation                      | Downloaded by setup-voice.cmd                                                                       |
| Installed local speech voice          | Read-aloud                     | Windows/browser voice settings                                                                      |

A GPU is optional. Speech setup uses CPU/int8. Downloads, provider sign-in, AI inference and public Google Docs need internet. OCR and transcription run locally after setup.

If a native tool reports missing Visual C++ DLLs, install Microsoft's [supported Visual C++ Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist) for its architecture and retry. Python packages cannot repair missing system DLLs.

## Install Git and Node.js

Install missing packages through [WinGet](https://learn.microsoft.com/en-us/windows/package-manager/winget/):

```powershell
winget install --id Git.Git --exact --source winget --accept-package-agreements --accept-source-agreements
winget install --id OpenJS.NodeJS.LTS --exact --source winget --accept-package-agreements --accept-source-agreements
```

Windows may require administrator approval. If WinGet is unavailable, use the official installers linked above. Open a new terminal and check:

```powershell
git --version
node --version
npm.cmd --version
```

Node must be 22.13 or newer. Use npm.cmd if PowerShell blocks npm's script shim. The repository's CMD wrappers set execution policy only for their own PowerShell process.

## Clone and install packages

```powershell
git clone https://github.com/gkothe/rpg_local.git
Set-Location rpg_local
npm.cmd install
```

Install both npm workspaces from the root. A separate install in each app is unnecessary.

## Set up PostgreSQL

### Use an installed local server

Install PostgreSQL's server and command-line tools from the [Windows download page](https://www.postgresql.org/download/windows/). Start its Windows service. Keep its administrator password in your password manager; pgAdmin and StackBuilder are optional.

```powershell
.\setup-database.cmd
```

Enter the port (default 5432), administrator username (default postgres) and password. Setup creates database rpg_local and non-superuser role rpg_local_owner with a generated password, saves `RPG_DATABASE_URL` in the repository-root `.env`, and applies migrations. Existing unrelated `.env` entries are preserved. The file is ignored by Git; `.env.example` contains placeholders only. This script does not save the administrator password.

If the database or role already exists, provisioning stops. Configure its known dedicated game URL instead:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-database.ps1 -ConfigureExisting
```

The URL prompt is hidden. Only loopback PostgreSQL is supported. Do not use postgres, template0 or template1 as the game database. If an existing administrator password is unknown, use a separate instance below rather than changing that server's credentials or authentication.

### Separate instance without an existing administrator password

This procedure starts PostgreSQL under your Windows account, outside the checkout, without a Windows service. It does not alter another database instance.

1. Follow the binary ZIP link on the [official PostgreSQL Windows page](https://www.postgresql.org/download/windows/) to [EDB's binary downloads](https://www.enterprisedb.com/download-postgresql-binaries).
2. Download the published PostgreSQL 18 Windows x64 binary ZIP to %TEMP%\local-rpg-postgresql.zip. An agent should resolve the current publisher link itself rather than guessing a patch-version URL. This x64 procedure does not establish ARM compatibility.
3. Run the following from the cloned repo. It refuses to overwrite an existing app-owned cluster.

```powershell
$ErrorActionPreference = 'Stop'
$taskPgRoot = Join-Path $env:LOCALAPPDATA 'LocalRPG\postgres'
$taskPgData = Join-Path $taskPgRoot 'data'
$taskPgBin = Join-Path $taskPgRoot 'pgsql\bin'
$taskPgArchive = Join-Path $env:TEMP 'local-rpg-postgresql.zip'
if (Test-Path -LiteralPath $taskPgData) {
    throw 'An app cluster exists. Use the restart/recovery instructions instead.'
}
if (-not (Test-Path -LiteralPath $taskPgArchive)) {
    throw 'Download the official binary ZIP first.'
}
if (-not (Test-Path -LiteralPath (Join-Path $taskPgBin 'initdb.exe'))) {
    New-Item -ItemType Directory -Force -Path $taskPgRoot | Out-Null
    Expand-Archive -LiteralPath $taskPgArchive -DestinationPath $taskPgRoot
}
foreach ($taskPgTool in @('initdb.exe', 'pg_ctl.exe', 'psql.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $taskPgBin $taskPgTool))) {
        throw 'Locate the extracted pgsql/bin folder and update taskPgBin.'
    }
}
& (Join-Path $taskPgBin 'initdb.exe') --version
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL binaries could not run.' }
$taskPgPort = 55432
while (Get-NetTCPConnection -State Listen -LocalPort $taskPgPort -ErrorAction SilentlyContinue) {
    $taskPgPort++
}
$taskPgPassword = & node.exe -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
if ($LASTEXITCODE -ne 0) { throw 'Password generation failed.' }
$taskPgPasswordFile = Join-Path $taskPgRoot 'initdb-password.tmp'
$taskPgPassword | Set-Content -LiteralPath $taskPgPasswordFile -Encoding ASCII
$taskPgEncrypted = ConvertTo-SecureString $taskPgPassword -AsPlainText -Force | ConvertFrom-SecureString
@{ port = $taskPgPort; adminPassword = $taskPgEncrypted } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskPgRoot 'bootstrap.json') -Encoding UTF8
try {
    & (Join-Path $taskPgBin 'initdb.exe') -D $taskPgData -U postgres --encoding=UTF8 --locale=C --auth=scram-sha-256 --pwfile=$taskPgPasswordFile
    if ($LASTEXITCODE -ne 0) { throw 'Initialization failed; inspect the cluster before retrying.' }
} finally {
    Remove-Item -LiteralPath $taskPgPasswordFile -ErrorAction SilentlyContinue
}
Add-Content -LiteralPath (Join-Path $taskPgData 'postgresql.conf') -Value @("listen_addresses = '127.0.0.1'", "port = $taskPgPort")
& (Join-Path $taskPgBin 'pg_ctl.exe') -D $taskPgData -l (Join-Path $taskPgRoot 'server.log') -w start
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL could not start; inspect server.log.' }
$taskPgPayload = @{ port = $taskPgPort; user = 'postgres'; password = $taskPgPassword } | ConvertTo-Json -Compress
$taskPgResult = $taskPgPayload | & node.exe scripts/provision-database.mjs
$taskPgPayload = $null
$taskPgPassword = $null
if ($LASTEXITCODE -ne 0) { throw 'Provisioning failed; inspect existing database/role state.' }
$env:RPG_DATABASE_URL = ($taskPgResult | ConvertFrom-Json).databaseUrl
$taskPgResult = $null
& powershell -ExecutionPolicy Bypass -File .\setup-database.ps1
if ($LASTEXITCODE -ne 0) { throw 'Database configuration/migrations failed.' }
```

The bootstrap password belongs only to this new instance. Its DPAPI-encrypted recovery value is in bootstrap.json; the game uses its separate restricted role. Keep these files outside Git. Never print the decrypted password or game URL in tool output or chat. [initdb](https://www.postgresql.org/docs/18/app-initdb.html) and [pg_ctl](https://www.postgresql.org/docs/18/app-pg-ctl.html) describe the PostgreSQL commands.

After reboot, start this instance before the app:

```powershell
$taskPgRoot = Join-Path $env:LOCALAPPDATA 'LocalRPG\postgres'
$taskPgCtl = Join-Path $taskPgRoot 'pgsql\bin\pg_ctl.exe'
& $taskPgCtl -D (Join-Path $taskPgRoot 'data') status
if ($LASTEXITCODE -ne 0) {
    & $taskPgCtl -D (Join-Path $taskPgRoot 'data') -l (Join-Path $taskPgRoot 'server.log') -w start
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL startup failed.' }
}
.\start.cmd
```

Stop the app before stopping the database:

```powershell
$taskPgRoot = Join-Path $env:LOCALAPPDATA 'LocalRPG\postgres'
& (Join-Path $taskPgRoot 'pgsql\bin\pg_ctl.exe') -D (Join-Path $taskPgRoot 'data') -m fast -w stop
```

For partial setup, inspect PG_VERSION, server.log, the saved port and existing roles/databases. Rerun provisioning only when both game role and database are absent. If this app-owned instance has a lost game password, its encrypted bootstrap administrator credential can rotate the game role's password, followed by ConfigureExisting. Never delete or reinitialize an existing cluster to repair setup.

## Install an AI CLI

You need at least one AI provider: a CLI from this section, or a Gemini API / OpenRouter key from [the API section](#optional-gemini-api-and-openrouter). To use a CLI, install it under the same Windows account used to run the app. A desktop app or IDE alone does not guarantee that its CLI exists. Account access and model entitlement are managed by each provider.

### Codex

```powershell
npm.cmd install -g @openai/codex
codex --version
codex login
codex login status
```

Choose ChatGPT sign-in. The app's adapter expects subscription authentication. See the [official Codex CLI guide](https://developers.openai.com/codex/cli).

### Claude Code

Use the [official Windows installer](https://code.claude.com/docs/en/setup):

```powershell
irm https://claude.ai/install.ps1 | iex
```

Open a new terminal, run claude --version, then launch claude and complete sign-in with an eligible account. Exit its interactive session afterward.

### Antigravity

Install the actual agy CLI using [Google's instructions](https://antigravity.google/docs/getting-started?tab=cli):

```powershell
irm https://antigravity.google/cli/install.ps1 | iex
```

Open a new terminal, run agy --help, then launch agy and finish its first-run/account setup.

Restart a running Local RPG backend after installing a CLI, then refresh diagnostics in Settings. Restart the parent terminal/agent app if its PATH is stale, or refresh its process PATH from the Windows user/machine environment.

If discovery still fails, RPG_CODEX_BIN, RPG_CLAUDE_BIN or RPG_AGY_BIN can point to an absolute native executable or JavaScript entrypoint. CMD, BAT and PowerShell wrappers are rejected as overrides; locate their underlying binary instead. Select models/efforts from the discovered frontend options rather than hard-coding this guide's examples.

## Optional: Gemini API and OpenRouter

Gemini API and OpenRouter are extra providers beside the CLIs; they never replace them and nothing switches to them automatically. They run in the cloud: every request sends the assembled campaign context (selected sources, knowledge, history and your action) to that service, billed to your API account.

Add both a key and a model list for each provider you want to the root `.env` (the file is ignored by Git; see `.env.example`):

```text
GEMINI_API_KEY=...
GEMINI_MODELS=gemini-2.5-pro,gemini-2.5-flash
OPENROUTER_API_KEY=...
OPENROUTER_MODELS=anthropic/claude-sonnet-4.5,google/gemini-2.5-pro
```

- The model variables are comma-separated model ids, **best first**; choose ids your account can use. Gemini and OpenRouter have separate variables. Keys come from [Google AI Studio](https://aistudio.google.com/apikey) and [OpenRouter](https://openrouter.ai/keys).
- **OpenRouter waterfall:** if the selected model is rate limited, unavailable, errors on the server or cannot be reached, the app tries the later entries of `OPENROUTER_MODELS` in order; put `openrouter/free` last. Authentication, refusal and cancellation never fall back, the fallback is sticky for that one generation, and previous-model reasoning data is dropped before another model continues. The trace logs each switch. Gemini has no fallback.
- Gameplay needs tool calling and ordinary calls need JSON output. For OpenRouter choose models whose supported parameters include `tools` and `response_format`; free models are rate limited and shared. Duplicate or malformed ids disable only that provider and Settings shows why.
- Restart the backend after editing `.env`; Refresh diagnostics only rereads state the running backend already has.
- Keys stay in the backend. They are never sent to the browser, saved in campaigns, archives or templates, written to logs, or given to CLI subprocesses.
- Settings reports a provider as configured when the key and models are present. It does not call the service, so an invalid key, missing model access or exhausted quota appears as an explicit error on the first real request. API models offer no effort options.
- Mocked tests do not prove a live model works. Verify one model per provider with a disposable campaign: an ordinary reply, a turn with trusted dice and a rule or source read, the narrative editor, and a cancellation.

## PDFs, OCR and dictation

Plain-text imports need no Python. For PDFs and dictation, install Python 3.12:

```powershell
winget install --id Python.Python.3.12 --exact --source winget --accept-package-agreements --accept-source-agreements
```

Open a new terminal, verify py -3.12 --version, then:

```powershell
.\setup-voice.cmd
```

This creates %LOCALAPPDATA%\LocalRPG\runtime, installs the locked Python dependencies, downloads the multilingual Whisper base model and verifies offline loading. It saves paths in runtime.json under %LOCALAPPDATA%\LocalRPG. Dependencies include MarkItDown, PDFium/Pillow, Faster-Whisper and PyAV. A separate MarkItDown checkout and standalone FFmpeg executable are unnecessary.

For PDFs without a speech-model download, use:

```powershell
$taskRuntime = Join-Path $env:LOCALAPPDATA 'LocalRPG\pdf-runtime'
py -3.12 -m venv (Join-Path $taskRuntime 'venv')
if ($LASTEXITCODE -ne 0) { throw 'Python environment creation failed.' }
$taskPython = Join-Path $taskRuntime 'venv\Scripts\python.exe'
& $taskPython -m pip install -r rpg_be_local/python/requirements-lock.txt
if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed.' }
& $taskPython -m pip check
if ($LASTEXITCODE -ne 0) { throw 'Python dependency check failed.' }
$env:RPG_PYTHON_BIN = $taskPython
[Environment]::SetEnvironmentVariable('RPG_PYTHON_BIN', $taskPython, 'User')
```

For scanned pages, install the Windows build linked by the [Tesseract project](https://tesseract-ocr.github.io/tessdoc/Installation.html#windows), or use:

```powershell
winget install --id UB-Mannheim.TesseractOCR --exact --source winget --accept-package-agreements --accept-source-agreements
```

Locate tesseract.exe. The following assumes the common Program Files location and provides English/Portuguese data from [Tesseract's fast models](https://github.com/tesseract-ocr/tessdata_fast):

```powershell
$taskTesseract = 'C:\Program Files\Tesseract-OCR\tesseract.exe'
if (-not (Test-Path -LiteralPath $taskTesseract)) {
    throw 'Locate tesseract.exe and update taskTesseract.'
}
$taskTessdata = Join-Path $env:LOCALAPPDATA 'LocalRPG\tessdata'
New-Item -ItemType Directory -Force -Path $taskTessdata | Out-Null
foreach ($taskLanguage in @('eng', 'por')) {
    $taskLanguageFile = Join-Path $taskTessdata "$taskLanguage.traineddata"
    if (-not (Test-Path -LiteralPath $taskLanguageFile)) {
        Invoke-WebRequest -Uri "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/$taskLanguage.traineddata" -OutFile $taskLanguageFile
    }
}
$env:RPG_TESSERACT_BIN = $taskTesseract
$env:TESSDATA_PREFIX = $taskTessdata
[Environment]::SetEnvironmentVariable('RPG_TESSERACT_BIN', $taskTesseract, 'User')
[Environment]::SetEnvironmentVariable('TESSDATA_PREFIX', $taskTessdata, 'User')
& $taskTesseract --list-langs
if ($LASTEXITCODE -ne 0) { throw 'Tesseract language verification failed.' }
```

The output must list eng and por. Restart the backend with these variables, or restart the parent terminal/app to inherit the saved environment. OCR can misread tables and character sheets; optional text editing remains available.

For read-aloud, install a local voice through Windows Settings > Time & language > Speech, then restart the browser. The app uses local voices exposed by that browser. Dictation does not supply a speaking voice. See the [runtime reference](local-runtime.md) for offline reuse and speech checks.

## Launch and verify

```powershell
.\start.cmd
```

Open http://127.0.0.1:5174. For the built app, use start.cmd run and http://127.0.0.1:4100. Keep the terminal open; Ctrl+C stops the app but not a separately managed PostgreSQL process/service.

Check from another terminal:

```powershell
$taskHealth = Invoke-RestMethod http://127.0.0.1:4100/api/health
if ($taskHealth.data.status -ne 'ok' -or -not $taskHealth.data.database) {
    throw 'Backend is running but PostgreSQL is not ready.'
}
```

Then check the browser:

1. Settings shows the CLI and its model/effort options.
2. Create a disposable campaign and send a simple opening action. Confirm both messages appear. This consumes provider allowance; database health alone does not prove AI access.
3. If installed, import a small synthetic scanned PDF, dictate a sentence and read a reply aloud.

Use synthetic inputs and a disposable campaign for installation checks. Report account/quota/microphone blocks instead of claiming they worked.

## Update and migrate

Stop the app and back up valuable campaigns and private libraries first:

```powershell
git pull --ff-only
npm.cmd install
.\setup-database.cmd
.\start.cmd
```

The root `.env` lets database setup apply pending migrations without asking again for administrator login. Versioned SQL lives in rpg_be_local/migrationssql and execution is recorded in migration_history. Do not edit applied migrations or create tables manually.

The backend automatically loads `.env` from the repository root, including when started from a workspace or compiled output. Explicit process environment variables take precedence. The Windows launcher loads the same file plus saved LAN/speech settings. To use npm directly:

```powershell
npm.cmd run migrate
npm.cmd run build
npm.cmd start
```

For manual configuration, copy `.env.example` to `.env` and replace the database placeholders. Restart the backend after changing the file. `npm test` runs the backend with `NODE_ENV=test` and uses `RPG_TEST_DATABASE_URL`, which must target a separate database whose name ends in `_test`; without it the database suites are skipped. `setup-test-database.ps1` asks for the PostgreSQL administrator login once, creates the limited `rpg_local_test_owner` role and `rpg_local_test` database, and writes that line to `.env` (rerunning it resets the role password). The administrator password is not saved. Never point tests at the game database.

Older installations stored the game connection in `%LOCALAPPDATA%\LocalRPG\database.json`. That file is no longer loaded. Transfer the connection privately to the root `.env`, or run `setup-database.ps1 -ConfigureExisting` with your existing URL. Do not print connection credentials in tool output or chat. The bootstrap recovery file for a separately provisioned PostgreSQL server remains separate from the game connection.

## Installation by a coding agent

When asked to clone and install, follow these steps. Read root CLAUDE.md and AGENTS.md after cloning. The project does not require the author's workspace or shared skills.

1. Inspect architecture, disk space and installed Git, Node/npm, PostgreSQL, CLIs and Python. Reuse compatible tools; install missing dependencies from the sources above. Refresh PATH and verify versions/exit codes.
2. Clone into a local writable folder and install root npm dependencies. Preserve any existing checkout and uncommitted changes.
3. Reuse a supplied dedicated local game URL; otherwise use the separate PostgreSQL ZIP procedure. Resolve its official download link yourself, choose an unused port, initialize once, provision through the existing script, persist settings and migrate. Keep credentials out of output/chat.
4. Set up at least one AI provider. For a CLI: install the requested one (if none is specified, Codex has a documented install path), start the official login flow and let the user complete browser sign-in/MFA. For the Gemini API or OpenRouter: copy the `.env.example` entries into the root `.env` using the key and model ids the user supplied; if none were supplied, leave the commented placeholders and report the missing key as a remaining human action. Never print, log, commit or echo a key, never borrow other applications' tokens, and never create a paid subscription or API account for the user.
5. For a full-feature install, install Python, run voice setup, install Tesseract and both language files, persist paths and verify them. For text-only use, report these optional features as unconfigured. Use CPU defaults unless GPU configuration is requested.
6. Run npm.cmd run typecheck, npm.cmd run lint and npm.cmd run build. Start in the user's terminal or use Start-Process -WindowStyle Hidden with redirected output for an agent-managed background process. Record its PID; stop only the process you own.
7. Check health, provider diagnostics (installed CLIs and configured API providers) and a disposable GM exchange when account access permits. An API provider shown as configured has not yet proved its key or model access; only the exchange does. Test enabled PDF/audio features with synthetic material. Leave the app running on success.
8. Report the URL, start/stop commands, PostgreSQL reboot/start instructions, settings/data locations and remaining human actions.

UAC, provider sign-in/MFA and browser microphone permission may require the person. Other authorized setup work should proceed without repeated confirmations. The default desktop install does not change firewall ports, certificate trust or existing databases. Phone access is separate: [LAN setup](lan-setup.md).

## Common problems

| Symptom                       | What to check                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API provider not configured   | Settings names the missing variable: `GEMINI_API_KEY`/`GEMINI_MODELS` or `OPENROUTER_API_KEY`/`OPENROUTER_MODELS`; edit `.env` and restart the backend |
| API HTTP 503 or rate limit    | Provider-side demand or quota; pick another listed model or retry later (OpenRouter tries later list entries itself)                                   |
| Command not found             | Installation and fresh PATH; a provider desktop app may not include its CLI                                                                            |
| Database URL missing          | Run database setup and restart through start.cmd; direct npm needs environment settings                                                                |
| Connection refused            | Start the PostgreSQL service/cluster and check its saved port                                                                                          |
| Missing table/column          | Stop the app, run migrations, restart                                                                                                                  |
| Database/role already exists  | Use its known dedicated URL; do not drop it                                                                                                            |
| CLI/model unavailable         | CLI sign-in, model access, quota and refreshed diagnostics; version warnings alone do not disable gameplay                                             |
| PDF/dictation unavailable     | Python runtime paths, locked dependencies, local model and Tesseract languages                                                                         |
| No read-aloud voice           | Install a local OS voice and restart the browser                                                                                                       |
| Port already used             | Identify the listener; stop it only if it is yours, or deliberately configure app ports                                                                |
| Disk/permission/logging error | Check free space and permissions on the app, runtime and log folders                                                                                   |

Ordinary npm tests do not install external tools or authenticate an account. These instructions were checked against project scripts and publisher documentation. A full install on a clean Windows machine remains a separate verification step.

### Memory rebuild

Migration 0018 adds the memory rebuild tables; run `setup-database.cmd` and restart the backend. Without it, gameplay actions that check for active work fail with a database error. The Journal tab's **Rebuild memory** button uses your provider allowance and only stages a draft; nothing changes until you apply it. Default checks use mocked providers. An optional live smoke test must use a disposable campaign, and its allowance use and result are reported separately.

### Selective history

Migrations 0019 (history versions, fragments, receipts and the frozen session column) and 0020 (rebuild purpose) must be applied with `setup-database.cmd` before starting the updated backend. Existing campaigns keep the full-memory prompt until you prepare and activate a compact history in the Journal tab. Preparing uses your provider allowance (one call per 8 older turns, one per chapter and one overview) and can be cancelled or resumed. While selective history is on, an action that pushes a new block of 8 turns out of the recent window adds a section call, occasionally a chapter call, and one overview call to that action. An optional live smoke test must use a disposable campaign, and its allowance use and result are reported separately; default checks use mocked providers.

### Audited turns and narrative editing

Run `setup-database.cmd` after updating the repository. It applies numbered migrations,
including source audit storage (0009) and private narrative candidates (0010); restart
an already running backend afterwards. Migrations preserve existing campaigns.

If narrative editing fails because of quota or a CLI error, the GM candidate and dice
remain saved privately. Use **Resume narrative editing** after fixing the provider.
No gameplay or dice are repeated. **Cancel pending turn** abandons it instead. If the
campaign or rule instructions changed, resume is unavailable; cancel before a new action.
Do not delete database rows to clear a pending edit.

Campaign documents and character sheets have separate purposes. An opening action
receives initial campaign excerpts and can look up the rest. A source search with no
match is a normal result, not a failed turn. Uploads are ready immediately; correction
remains optional. GM-only continuity is hidden in normal views. Advanced context and
full backups can contain spoilers.

The ignored root `log` directory contains prompts, responses and correlated traces.
Treat these files as private campaign data and do not add them to a public repository.

### Compact NPC creation

Run normal database setup/migrations and restart after updating. Migrations 0022/0023 add frozen private NPC inputs and operational preparation receipts without publishing drafts. Every configured supported gameplay provider can use the on-demand creator with existing settings, including native CLIs. No extra environment flag is needed. No extra NPC model installation or account is required. Default tests mock provider generation and use isolated test schemas.

## Atlas setup

Run the normal root migration command for the intended dedicated local database before starting the updated app. Atlas migrations add manual edit receipts, frozen session geography, cartographer preparations, image assets/import jobs and extended session immutability. Tests continue to require a distinct `RPG_TEST_DATABASE_URL` ending in `_test`; do not use a gameplay database for tests. No atlas feature toggle or new environment variable is required.

Structured maps and cartographer preparations use the campaign's supported gameplay provider. Image conversion currently requires the isolated Codex CLI adapter with native `codex exec --image` support and a configured available model. Other selected adapters report an explicit unsupported image diagnostic; the app never silently changes provider. Uploaded PNG/JPEG files remain private until the whole original is explicitly reviewed for player display. Native image validation is separate from mocked tests and consumes provider account allowance.
