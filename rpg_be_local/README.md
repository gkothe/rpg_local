# Local RPG backend

Node >=22.13, Express5, PostgreSQL. Install/build/start from the repository root. No account/user model, cloud API client, legacy data import, map or adventure generator. The sibling frontend is served from its built `dist` directory. Without a configured/migrated database, diagnostics/frontend remain available and game routes return a setup error.

## PostgreSQL setup (Windows)

Create a **new dedicated local PostgreSQL database/user**, never reuse the old application's credentials/database. Set variables in your current PowerShell session:

```powershell
$env:RPG_DATABASE_URL = 'postgresql://YOUR_LOCAL_USER:YOUR_LOCAL_PASSWORD@127.0.0.1:5432/rpg_local'
npm run migrate
npm run dev
```

URL-encode password punctuation. Variables are read from process environment; `.env` files are not automatically loaded. Do not commit passwords. Migrations are explicit, transactionally applied, recorded by filename, and immutable after application. The test database is separate:

```powershell
$env:NODE_ENV = 'test'
$env:RPG_TEST_DATABASE_URL = 'postgresql://YOUR_TEST_USER:YOUR_TEST_PASSWORD@127.0.0.1:5432/rpg_local_test'
npm run migrate
npm test --workspace rpg-be-local
Remove-Item Env:NODE_ENV
```

Tests never generate AI text. Eight real SQL tests run only with `NODE_ENV=test` and the dedicated URL. The URL must be loopback, distinct from application URL, and its database name must end in `_test`. Tests add isolated UUID fixtures; they never drop/truncate a user's database.

The ordinary SQL suite now also checks simultaneous duplicate/distinct request races. An additional extended service regression is opt-in: set `RPG_LONG_CAMPAIGN_TESTS=1` with the isolated test database, then run `npm test --workspace rpg-be-local`. It executes1000 persisted turns with synthetic provider responses, automatic compaction, model/provider switches and undo/checkpoint invalidation. No live AI is invoked. This test requires already-applied migrations and took143seconds on the verified Windows fixture. Remove the opt-in variable afterward for the ordinary suite.

## CLI/model setup

Authenticate with installed CLIs in their own terminals. The app never asks for/exports subscription tokens. `/api/providers` separates executable availability, verified isolation and configured options.

Claude requires an installed version exposing `--safe-mode`, `--no-session-persistence`, `--tools`, `--json-schema`. It runs in a temporary directory with tools/customization/MCP/session persistence disabled, retains normal subscription login, and suppresses inherited API-key overrides. Real login/model entitlement still needs validation.

Antigravity **1.2.14** passed real subscription-backed narration, state updates and undo. The app discovers its models and groups effort variants in the selector. Each call uses a unique temporary global GM agent with default components, ambient rules/skills/plugins, MCP and file/network tools excluded. Its definition is removed afterward; trust and login settings are unchanged. Hooks must be absent, checked before every call. Other Antigravity versions fail closed until verified. See [the integration report](../docs/reviews/antigravity-integration.md).

Codex gameplay is supported on verified CLI 0.159.2 with native file-backed ChatGPT login, account-cache model choices and a fresh isolated no-tools home per turn. Four boundary tests and an actual native anonymous-loopback protocol test passed; no Codex model request was made. See `../docs/reviews/codex-provider-status.md` for isolation, authentication hardlinks and version/login gates. Claude has adapter fixture coverage but was not live-tested; the installed CLI must expose the required isolation flags and advertise model aliases through installed help, or use an explicit local model catalog. Native/npm discovery and CLI help were verified; no Claude gameplay call was made.

Antigravity needs no manual catalog. For other supported adapters, configure only model IDs/efforts verified in your own CLI/account. `inputTokens` is a safe input allowance capped at16000;3200 is reserved from each gameplay/compaction/draft ceiling for provider overhead. Example shape (replace identifiers with verified current values):

```powershell
$env:RPG_MODEL_CATALOG = '[{"provider":"claude","models":[{"id":"YOUR_VERIFIED_MODEL_ID","label":"My verified model","efforts":["low","medium","high"],"inputTokens":16000}]}]'
```

Restart after configuration changes; refresh executable discovery with `GET /api/providers?refresh=true`. `RPG_CLAUDE_BIN`, `RPG_CODEX_BIN`, `RPG_AGY_BIN` accept native executable paths; Claude also accepts its installed JavaScript entrypoint. Shell wrappers/browser-supplied commands are never executed.

Every gameplay/compaction/character-draft call is fresh; no resume, provider fallback or silent mock. Strict schema/prior-value checks precede a short locked atomic commit. Long calls run outside transactions. Leases recover expired jobs as interrupted; retry requires a new request ID.

## Context/undo

Context contains current player/relevant NPC state, pinned facts, confirmed current source text, bounded memory and complete uncovered recent turns. Full transcript stays stored separately. UTF-8 byte count is a deliberately pessimistic token estimate with a provider-envelope reserve. Mandatory data/uncovered turns are never truncated; oversized inputs/summaries require correction or a reviewed manual checkpoint. Validation cannot prove narrative truth.

Compaction processes consecutive narrative batches (ceiling8000), never full saved manifests, with memory ceiling2000. PostgreSQL full-text retrieval uses corrected confirmed text. Whole-source pins and current-version section pins are supported. Corrections clear old section pins, so review and select sections again. Retrieval ranks OR-matched action keywords; unrelated character names cannot prevent a rule match. Relevant NPC selection uses current state/action/pinned facts/recent scene names and IDs. Lexical retrieval may miss implicit rules.

Undo restores latest completed turn-owned character fields/state/newNPCs without an AI call. Unrelated manual fields/private notes survive; conflicts block undo. Covering memory checkpoints are invalidated. Undone events stay auditable but are excluded from prompts. Archives preserve snapshots and remap structured IDs/manifests/coverage.

## Local documents/audio

Install Python requirements into a local virtual environment outside synced folders; `RPG_PYTHON_BIN` selects its executable. This app owns its adapters and does not rely on the separate MarkItDown checkout.

```powershell
python -m venv C:\Users\YOUR_USER\rpg-local-python
C:\Users\YOUR_USER\rpg-local-python\Scripts\python.exe -m pip install -r rpg_be_local/python/requirements.txt
$env:RPG_PYTHON_BIN = 'C:\Users\YOUR_USER\rpg-local-python\Scripts\python.exe'
```

PDFium inspects pages; MarkItDown converts native-text pages; Tesseract OCR handles sparse/scanned pages rendered at300DPI. Install Tesseract with `eng`/`por` data and optionally set `RPG_TESSERACT_BIN`. Page/hash/method/word confidence/coordinates/warnings are retained. Draft extracted text requires correction/confirmation. Tables/reading order need review. Staged renderings are deleted after processing. The uploaded original is retained in PostgreSQL for the original-document viewer; deleting the source/campaign removes it. Archives/templates retain extracted text and provenance, but omit original binaries and mark the original unavailable. Limits:20MiB upload,300pages,120second extraction,10MiB text. Empty/failed scans cannot become successful blank sources.

FasterWhisper transcribes locally with English/Portuguese/auto detection. Set `RPG_WHISPER_MODEL_PATH` to a **pre-downloaded local model directory**. Downloads are a separate setup action; request-time inference never downloads secretly. Optional `RPG_WHISPER_DEVICE=cpu` default.120second recordings are deleted afterward. Diagnostics expose missing runtime/model; typing remains available. Frontend local installed voices read committed GM text without an AI request.

Actual Windows native/scanned/mixed/Portuguese/blank PDF cases and synthetic speech inference passed using the separately installed local runtimes. Models/runtime are not included in the Node install; extraction still requires human review.

## Optional LAN

Default bind127.0.0.1:4100. Opt in with `RPG_LAN_HOST` set to an explicit privateIPv4 interface. A loopback listener remains for desktop approval. Add a narrow Windows Private-network firewall rule manually if needed; the app never modifies firewall/trust settings.

Unpaired LAN clients cannot read/write campaigns. Desktop `POST /api/lan/code` creates a two-minute single-use code; phone `POST /api/lan/pair` exchanges it for a twelve-hour HttpOnly same-site cookie. Revoke clears all devices; restart clears sessions. This approves devices without application accounts. The frontend exposes desktop code/revoke and phone pair/reconnect flows. HTTP supports typing; microphone needs HTTPS trusted by the phone. Set RPG_TLS_CERT_PATH and RPG_TLS_KEY_PATH to local PEM files to enable the native HTTPS listener (RPG_HTTPS_PORT defaults to4443). The certificate must cover the selected LAN IP. Actual Android Chrome certificate trust and microphone checks remain device setup gates; certificates/tunnels are not provisioned or trusted automatically.

Contract: [docs/api-contract.md](docs/api-contract.md). Writes require `X-RPG-Client: local-rpg`, approved Host/Origin, JSON or multipart. Database/CLI control stays on the host.
