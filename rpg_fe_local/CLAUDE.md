# Frontend working rules

Read `../CLAUDE.md`, `../AGENTS.md` and the backend-owned `../docs/documentation/api-contract.md`.

- React/TypeScript/Vite, relative `/api`; development proxy uses loopback port 4100. No application auth or cloud API credentials.
- Backend owns domain options, labels, defaults and capabilities. Revision fields are informational; older revision numbers do not block saves. Client workflow states are separate.
- Sequential app I/O. Turn submissions use a synchronous single-flight guard, stable request identity for uncertain retries, and ignore acknowledgements from an obsolete campaign view.
- Keep drafts separate from refreshed canonical campaign data. Save only the fields the user edited against the current row.
- Imported source/GM content is rendered as text. No unsanitized HTML. FormData never receives a manually set Content-Type.
- Microphone access is explicit. Cancellation/unmount discards audio and stops tracks; confirmed transcript goes into the editable composer, never directly into a game turn.
- Read-aloud offers only `localService` browser voices; no AI call, autoplay or cloud fallback.
- Candlelit Tome theme (dark ground, parchment narrative, bundled Cinzel and EB Garamond fonts); English copy, visible keyboard focus, 44px mobile controls. Mobile forms have one field per row.
- Run lint (zero warnings), typecheck, formatting check, unit tests and synthetic browser tests. Report real CLI/OCR/phone/browser-voice validation separately.

## Verified gotchas

- Success responses wrap `data`; errors use problem `detail` and `code`. Revision conflict text must reach the user.
- Backend audio route is `/audio/transcriptions`, multipart field `file`; browser MIME selection must match upload extension.
- `MediaRecorder` acquisition is asynchronous: guard before requesting permission and stop late streams after cancellation.
- Root owns npm install and lockfile. Do not install while another agent is changing packages.
