import { Problem } from '../errors.js';
import { CODEX_INPUT_TOKENS } from './codex.js';
import type { ProviderSettings } from '../domain/types.js';
import { MAX_PROVIDER_INPUT_TOKENS, PROVIDER_ID } from './options.js';
export function providerArgs(
  id: string,
  settings: ProviderSettings,
  schemaPath: string,
  schema: unknown
): string[] {
  if (id === PROVIDER_ID.Claude)
    return [
      '-p',
      '--safe-mode',
      '--no-session-persistence',
      '--tools',
      '',
      '--disable-slash-commands',
      '--strict-mcp-config',
      '--mcp-config',
      '{"mcpServers":{}}',
      '--no-chrome',
      '--output-format',
      'json',
      '--json-schema',
      JSON.stringify(schema),
      '--model',
      settings.model,
      ...(settings.effort ? ['--effort', settings.effort] : []),
      '--system-prompt',
      'You are a tabletop RPG narrator. The supplied JSON is the entire campaign context. No tools or outside context.',
    ];
  if (id === PROVIDER_ID.Codex)
    return [
      'exec',
      '--ignore-user-config',
      '--ignore-rules',
      '--ephemeral',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--json',
      '--output-schema',
      schemaPath,
      '-m',
      settings.model,
      ...(settings.effort
        ? ['-c', `model_reasoning_effort=${JSON.stringify(settings.effort)}`]
        : []),
      '-',
    ];
  if (id === PROVIDER_ID.Antigravity)
    throw new Problem(422, 'provider_contract', 'Antigravity requires its isolated agent launcher');
  throw new Problem(422, 'provider_unknown', 'Unknown CLI provider');
}
export function parseProviderOutput(id: string, output: string): unknown {
  try {
    if (id === PROVIDER_ID.Antigravity) {
      const events = output
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line));
      const init = events.find((event) => event.event === 'init')?.init;
      const result = events.filter((event) => event.event === 'result').at(-1)?.result;
      if (
        !init?.agent?.startsWith('local-rpg-') ||
        result?.status !== 'SUCCESS' ||
        result.num_turns !== 1
      )
        throw new Problem(
          502,
          'provider_isolation',
          'Antigravity did not complete one isolated GM turn'
        );
      if (
        !Number.isFinite(result.usage?.input_tokens) ||
        result.usage.input_tokens > MAX_PROVIDER_INPUT_TOKENS
      )
        throw new Problem(
          502,
          'provider_budget',
          'Antigravity exceeded the verified input envelope'
        );
      const response = result.response.trim();
      const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(response);
      return JSON.parse(fenced ? fenced[1]! : response);
    }
    if (id === PROVIDER_ID.Codex) {
      const events = output
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      if (
        events.some(
          (event) =>
            event.item && !['agent_message', 'reasoning', 'error'].includes(event.item.type)
        )
      )
        throw new Problem(
          502,
          'provider_isolation',
          'Codex returned unexpected tool activity; generation rejected'
        );
      if (events.some((event) => event.type === 'turn.failed' || event.type === 'error'))
        throw new Problem(502, 'provider_failure', 'Codex reported a failed generation');
      const completed = events.filter((event) => event.type === 'turn.completed');
      const messages = events.filter(
        (event) => event.type === 'item.completed' && event.item?.type === 'agent_message'
      );
      if (completed.length !== 1 || messages.length !== 1)
        throw new Problem(502, 'provider_isolation', 'Codex did not complete one isolated GM turn');
      const inputTokens = completed[0].usage?.input_tokens;
      if (!Number.isInteger(inputTokens) || inputTokens < 0 || inputTokens > CODEX_INPUT_TOKENS)
        throw new Problem(
          502,
          'provider_budget',
          'Codex exceeded or did not report the verified input envelope'
        );
      return JSON.parse(messages[0].item.text);
    }
    const envelope = JSON.parse(output);
    if (envelope.is_error || envelope.error)
      throw new Problem(502, 'provider_failure', 'CLI reported a failed generation');
    if (envelope.structured_output) return envelope.structured_output;
    if (typeof envelope.result === 'string') return JSON.parse(envelope.result);
    if (typeof envelope.response === 'string') return JSON.parse(envelope.response);
    if (envelope.version === 1 || typeof envelope.text === 'string') return envelope;
    throw new Error('missing');
  } catch (e) {
    if (e instanceof Problem) throw e;
    throw new Problem(502, 'provider_json', 'Local CLI did not return the required JSON response');
  }
}
