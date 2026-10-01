# Codex provider status and in-game switching

Codex gameplay is now enabled on the verified installed CLI version 0.159.2. A fresh actual `ProviderService` probe returned `available: true`, `supported: true`, four current account-cache models and no blocking reason. Model choices come from local public CLI metadata; automatic-delegation effort `ultra` is excluded. Other CLI versions fail closed until this isolation contract is verified on them. Each model's subscription entitlement remains checked when used.

Every game request uses a fresh working directory and fresh ephemeral Codex home. The adapter replaces model metadata with direct tool mode, disabled shell and no patch/experimental tools; disables agents, goals, hooks, plugins, app/browser/voice tools, memory and skill instructions; ignores user configuration/rules and project documents; and strips inherited desktop/session/API-key variables. The app supplies only its saved bounded campaign context and narrator instructions. The CLI still receives its ordinary minimal environment description (temporary working directory, OS/date and sandbox); this contains no external game history or user instructions.

The original Codex home cannot safely be used directly: its global AGENTS.md is injected even when user config/rules and project documents are disabled. Instead, the adapter creates an isolated home beneath the native Codex home and hardlinks only the CLI-owned auth.json. The app does not read, copy or log authentication contents. Codex itself authenticates through that native file-backed ChatGPT login, with API-key mode rejected. Missing file-backed login or a filesystem without hardlinks produces a setup error. Cleanup validates the exact owned child directory before removing it, leaving the original home intact.

Authentication refresh was checked independently of any real account: official `FileAuthStorage.save` uses truncate/write on its existing file, and the actual installed CLI's synthetic local login retained the hardlink inode and changed both linked file sizes. Thus CLI-managed refresh writes remain shared with the original native auth file; the application does not synchronize credential contents. No original auth file or global configuration was changed by verification.

The maintained `codex.runtime.test.ts` uses an anonymous loopback Responses fixture, never an AI service. On the actual CLI it verified two distinct fresh thread IDs, two model selections/effort choices, preserved saved campaign context, empty tool definitions, no AGENTS/skills/parent instructions and no Authorization header. Both responses passed strict parsing: exactly one successful completed turn and one final message, reported input within 8000 tokens, no tool activity or failed-turn events. A separate boundary test verifies native auth hardlinks and cleanup; parser cases cover missing completion, excessive usage, multiple messages/turns, errors and tools.

Initial verification used four Codex boundary/unit tests and the actual native offline runtime
test; those checks established isolation/protocol behavior only. The owner subsequently authorized
live Codex/Claude testing: three real Codex turns, three real Claude turns and two Codex memory
checkpoints passed with saved context and character-state continuity. This exposed a strict-schema
compatibility bug missed by the simplified fixture. Codex now transports application JSON in a
strict `payload_json` envelope and decodes before unchanged domain validation. The native test pins
that real transport schema. See [the live exchange](live-codex-claude.md) for the selected models,
failures/fixes and complete evidence; other models/efforts remain entitlement-dependent.

References: installed `codex exec --help` and `features list`, [official configuration schema](https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json), [global instruction loading](https://github.com/openai/codex/blob/main/codex-rs/codex-home/src/instructions/mod.rs), and [native authentication storage](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/storage.rs). Investigation scratch files stay outside Git.

CLI/model/effort switching already exists above the campaign tabs. Added an explicit Game master heading and explanatory text. A frontend regression test now switches an existing campaign from one provider to another, verifies the unsent action and previous narrative remain visible, and checks the next turn carries the new settings and current revision. Backend bounded-context/provider-switch coverage remains in the database tests.
