import { API_PROVIDER_ID, MAX_PROVIDER_INPUT_TOKENS, type ApiProviderId } from './options.js';

/** Environment variables are the only configuration surface; keys never leave backend memory. */
export const API_PROVIDER_CONFIG = {
  [API_PROVIDER_ID.Gemini]: {
    name: 'Gemini API',
    keyVariable: 'GEMINI_API_KEY',
    modelsVariable: 'GEMINI_MODELS',
  },
  [API_PROVIDER_ID.OpenRouter]: {
    name: 'OpenRouter',
    keyVariable: 'OPENROUTER_API_KEY',
    modelsVariable: 'OPENROUTER_MODELS',
  },
} as const satisfies Record<
  ApiProviderId,
  { name: string; keyVariable: string; modelsVariable: string }
>;
/** Same identifier grammar as the CLI catalog; OpenRouter ids contain `/` and `:`. */
const API_MODEL_ID = /^[\w./:-]{1,120}$/;
/** Context-selection target shown for configured API models; it is not an enforced limit. */
export const API_MODEL_INPUT_TOKENS = MAX_PROVIDER_INPUT_TOKENS;

export type ApiConfiguration = {
  id: ApiProviderId;
  name: string;
  /** Present only when the key variable is set; consumed by the HTTP adapters, never serialized. */
  key: string | null;
  models: string[];
  /** Sanitized, actionable reason the provider cannot be used; null when configured. */
  reason: string | null;
};

export function parseApiModelList(raw: string): { models: string[]; invalid: string | null } {
  const models: string[] = [];
  for (const entry of raw.split(',')) {
    const id = entry.trim();
    if (!id) continue;
    if (!API_MODEL_ID.test(id)) return { models: [], invalid: 'contains an invalid model id' };
    if (models.includes(id)) return { models: [], invalid: 'lists the same model twice' };
    models.push(id);
  }
  return { models, invalid: null };
}

/** Local inspection only: no network access and no account probe. */
export function readApiConfiguration(
  id: ApiProviderId,
  env: NodeJS.ProcessEnv = process.env
): ApiConfiguration {
  const { name, keyVariable, modelsVariable } = API_PROVIDER_CONFIG[id];
  const key = env[keyVariable]?.trim() || null;
  const { models, invalid } = parseApiModelList(env[modelsVariable] ?? '');
  const reason = !key
    ? `Set ${keyVariable} in the backend .env and restart the backend`
    : invalid
      ? `${modelsVariable} ${invalid}; use a comma-separated list of model ids`
      : !models.length
        ? `Set ${modelsVariable} to a comma-separated list of model ids and restart the backend`
        : null;
  return { id, name, key, models: reason ? [] : models, reason };
}

/** Child processes never inherit API credentials; API adapters use HTTP in this process only. */
export function withoutApiCredentials(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean = { ...env };
  for (const { keyVariable } of Object.values(API_PROVIDER_CONFIG)) delete clean[keyVariable];
  return clean;
}
