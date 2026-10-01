export const PROVIDER_ID = {
  Claude: 'claude',
  Codex: 'codex',
  Antigravity: 'agy',
} as const;

export const PROVIDER_IDS = [
  PROVIDER_ID.Claude,
  PROVIDER_ID.Codex,
  PROVIDER_ID.Antigravity,
] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const PROVIDERS: readonly { id: ProviderId; name: string }[] = [
  { id: PROVIDER_ID.Claude, name: 'Claude Code' },
  { id: PROVIDER_ID.Codex, name: 'Codex' },
  { id: PROVIDER_ID.Antigravity, name: 'Antigravity' },
];

export const MODEL_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ModelEffort = (typeof MODEL_EFFORTS)[number];
export const MAX_PROVIDER_INPUT_TOKENS = 16_000;
