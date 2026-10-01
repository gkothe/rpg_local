# Local RPG frontend

English React/TypeScript/Vite campaign journal. Read the [root setup guide](../README.md) for PostgreSQL, AI CLI and local Python prerequisites. Install dependencies once from the repository root with `npm install`; root owns the lockfile.

From the repository root:

```powershell
npm run dev
npm run build --workspace rpg-fe-local
npm run lint --workspace rpg-fe-local
npm run typecheck --workspace rpg-fe-local
npm run format:check --workspace rpg-fe-local
npm test --workspace rpg-fe-local
```

Development runs at `http://127.0.0.1:5174`, proxying relative `/api` to the loopback backend on4100. Production files build to `dist`; the backend serves that build. No frontend deployment URLs, login tokens, cloud API keys or mock-game fallback are included.

Development stays loopback-only. Never expose the Vite proxy to phones: proxied requests would look local to the backend. For LAN play, build the frontend and use the backend's direct same-origin production listener. Optional development HTTPS uses `RPG_DEV_HTTPS_CERT` and `RPG_DEV_HTTPS_KEY` pointing to external local certificate files; `RPG_DEV_API_TARGET` may select an HTTP/HTTPS loopback backend only. For a locally signed backend certificate, start Node with an appropriate `NODE_EXTRA_CA_CERTS` path; TLS verification is never disabled by the frontend config.

## Playing

Create a campaign, add characters, and paste or upload sources. Sources stay draft until extracted text is reviewed/corrected and confirmed. Public Google Docs and PDF extraction use the backend; missing OCR/Python dependencies produce a visible error rather than an empty successful import. Character parsing is an explicit CLI action and produces an editable draft requiring Add character before saving.

Select an available CLI, model and effort advertised by the backend. Write an action and send it explicitly. Your next unsent action remains in the composer while the current turn finishes. Only committed turns appear as GM responses; changes are inspectable and latest-turn undo is explicit. A lost submission response offers Retry original action using the same request identity. No automatic resubmission occurs.

Character and journal forms preserve local edits across turn refreshes and save with the revision they were based on. On a conflict, review the current game and use Reload current character/journal to discard old drafts explicitly. Personal notes stay outside GM context. Journal contains campaign settings, memory, pins, budgets and the last turn's context manifest. Full saved transcript can be loaded separately from the latest100-turn view.

Campaign templates reuse setup including characters; standalone character templates reuse one saved sheet in another campaign. Campaign JSON exports/imports create portable separate copies. File imports use uploaded bytes, never arbitrary browser file paths. Imported text is rendered as text rather than HTML. Confirmed sources offer individual section pins; original extraction pages/confidence and retained source documents are available for inspection.

## Audio and phone access

Dictation requires an available local Faster-Whisper backend, a supported MediaRecorder browser and HTTPS or localhost. Recording is explicit; Stop transcribes, Discard cancels, and leaving the campaign stops tracks. The transcript goes into the editable composer; only Send creates a game turn. No campaign history is sent for transcription.

Each committed GM message offers Read aloud. It uses only browser voices marked `localService`, with voice/speed/pause/resume/stop controls. Missing local voices are reported; no online voice fallback or new AI call is used. Windows Chrome playback was verified with an installed Microsoft George voice. Actual Android microphone permissions and offline voice availability remain device validation steps; see [Android Chrome checks](docs/android-chrome.md).

Settings shows approved LAN URLs and lets the desktop create a short-lived single-use connection code or revoke devices. Phones enter that code in the pairing dialog; expired/revoked connections reopen it while unsent drafts remain mounted. Successful reconnect refreshes saved state without replacing drafts. LAN binding, trusted HTTPS and firewall setup follow the backend/root guides; the UI does not provision certificates, tunnels or firewall changes.

## Browser verification

Synthetic Playwright tests mock only the HTTP boundary inside tests. Install a Playwright browser through your normal test setup, or select an already installed executable:

```powershell
$env:LOCAL_BROWSER_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
npm run test:e2e --workspace rpg-fe-local
```

The optional real-database smoke test requires a separately prepared isolated backend on4100. Never point it at an existing game database:

```powershell
$env:LOCAL_RPG_LIVE_SMOKE = '1'
npm run test:e2e --workspace rpg-fe-local -- local-database.spec.ts
Remove-Item Env:LOCAL_RPG_LIVE_SMOKE
```

Normal e2e runs skip that opt-in test. It creates/deletes dedicated smoke campaigns/template and invokes no AI.

Set `LOCAL_RPG_BASE_URL` to an already running production backend URL to run the same browser suite against the built application instead of starting Vite. `LOCAL_RPG_VOICE_SMOKE=1` enables a separate short synthetic installed-voice playback test; it invokes no AI or microphone. Windows Chrome completed this test using a local Microsoft George voice.

The other optional production checks use `LOCAL_RPG_LAN_BASE_URL` for the explicitly approved NIC HTTPS listener and `LOCAL_RPG_FAKE_AUDIO_WAV` for a generated synthetic PCM WAV. The backend must already have its local Whisper model/runtime configured. Never set either live test target to an existing personal campaign database. For example, after preparing an isolated backend:

```powershell
$env:LOCAL_RPG_BASE_URL = 'http://127.0.0.1:4100'
$env:LOCAL_RPG_LAN_BASE_URL = 'https://YOUR_APPROVED_LAN_ADDRESS:4443'
$env:LOCAL_RPG_FAKE_AUDIO_WAV = 'C:/path/to/synthetic-speech.wav'
npm run test:e2e --workspace rpg-fe-local -- production-lan.spec.ts local-dictation.spec.ts
```

Dictation tests require Chrome to report a fake audio input, never record the user's microphone, and assert no game turn was submitted. The LAN fixture's certificate-error allowance is limited to its test browser contexts and does not install trust on Windows or Android.
