import { type PromptTraceContext } from './promptLog.js';
import type { GameplayAdapter } from './gameplayTools.js';
import type { ProviderSettings } from '../domain/types.js';
import type { Executable } from './discovery.js';
import { generateAntigravityMcpBook } from './antigravityMcpBook.js';

export function antigravityDiceEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...source };
  for (const key of Object.keys(env)) {
    if (/^ANTIGRAVITY_|^CASCADE_|^MCP_|API_KEY|AUTH_TOKEN|OAUTH_TOKEN|^GEMINI_|^GOOGLE_/i.test(key))
      delete env[key];
  }
  return env;
}

/** Execute owned tools through private native MCP in one bounded logical turn. */
export async function generateAntigravityDice(
  executable: Executable,
  settings: ProviderSettings,
  prompt: string,
  cwd: string,
  sourceEnv: NodeJS.ProcessEnv,
  adapter: GameplayAdapter,
  signal?: AbortSignal,
  trace?: PromptTraceContext
): Promise<unknown> {
  return generateAntigravityMcpBook(
    executable,
    settings,
    prompt,
    cwd,
    sourceEnv,
    adapter,
    signal,
    trace
  );
}
