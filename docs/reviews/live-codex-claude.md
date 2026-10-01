# Live Codex and Claude exchange — 2026-10-01

The user authorized real subscription-backed turns through both CLIs. Android checks are on
hold; macOS/Linux compatibility is outside the requested validation scope.

## Result

Six real completed turns alternated Codex `gpt-5.6-sol`/low and Claude `sonnet`/low in one
synthetic PostgreSQL campaign. Every player action matched its persisted action; every returned
GM narrative matched its stored narrative. The frontend displayed all six player/GM exchanges.

| Turn | Provider | Verified behavior                                                                |
| ---- | -------- | -------------------------------------------------------------------------------- |
| 1    | Codex    | Tessa introduced password `LANTERN-47`.                                          |
| 2    | Claude   | Recalled that password and applied Mira's health 8 → 12 and potions 1 → 0.       |
| 3    | Codex    | Recalled the password and read the updated canonical sheet: 12 HP, zero potions. |
| 4    | Claude   | Recalled Tessa/password and supplied directions north to the old tower.          |
| 5    | Codex    | Recalled north/old tower/password and preserved the updated sheet.               |
| 6    | Claude   | Continued toward the correct destination using the saved conversation.           |

Two real Codex-generated memory checkpoints were created before turns 3 and 5. Continuity
survived both compactions and provider changes. Recorded gameplay context estimates ranged from
3,129 to 3,855 conservative token units, within the selected provider's capacity. These six short
turns validate this path, not every model entitlement or narrative accuracy.

The passing campaign remains available at
`http://127.0.0.1:4100/campaigns/b32f38d1-2519-46dd-ad44-51021135c23b` under
`[Verification] Codex and Claude relay 2`. A failed pre-fix Claude attempt remains in its audit;
normal Play shows the six completed turns. Raw diagnostic files and fixture evidence stay outside
Git. No existing user campaign was edited.

## Bugs found and fixed

- The current local Codex catalog changed after its earlier diagnostic cache was populated.
  The initial `gpt-6-luna` selection was rejected before generation; refreshing selected a
  currently advertised model. No model was substituted silently.
- Codex rejected the full application schema with `invalid_json_schema`: the operation union
  emits unsupported `oneOf`, and flexible character dictionaries also do not fit strict output
  schemas. Codex now receives a small strict transport envelope containing `payload_json`.
  The decoded object still goes through the unchanged application schema and atomic mutation
  validation. Malformed JSON, unexpected envelope fields, tool activity and budget failures
  remain rejected. Gameplay, character drafts and memory use the same transport.
- Claude rejected Zod's `https://json-schema.org/draft/2020-12/schema` meta-schema annotation
  before sending a model request. Its adapter removes that annotation from a copy while
  retaining the actual constraints; the application schema remains unchanged.

The previous native Codex fixture tested isolation with a simplified schema and did not detect
the provider-side application-schema rejection. It now pins the actual transport schema too.
Regression tests cover decoding arbitrary sheet values without bypassing domain validation and
Claude's schema annotation handling. The OpenAI strict schema restriction is documented in
[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

## Verification

- Ten focused provider regression tests passed.
- Native Codex anonymous-loopback isolation/transport test passed.
- Isolated PostgreSQL/backend suite: 36 passed, four explicit opt-in checks skipped.
- Frontend suite: 24 passed. Browser DOM verification displayed all six saved exchanges.
- Workspace lint/typecheck and backend build passed; changed-file formatting passed.
  The repository-wide formatting check flags the pre-existing untracked
  `rpg_be_local/docs/dice-rolling-architecture.md`; that unrelated work was left intact.
- The running application was rebuilt/restarted with both fixes before the successful exchange.
- Public audit: 151 public files, two production bundles and existing Git history scanned;
  zero secret findings.

No Android, macOS or Linux validation was attempted.
