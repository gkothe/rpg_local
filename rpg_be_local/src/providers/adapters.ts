import { Problem } from '../errors.js';
import type { ProviderSettings } from '../domain/types.js';
export function providerArgs(
  id: string,
  settings: ProviderSettings,
  schemaPath: string,
  schema: unknown
): string[] {
  if (id === 'claude')
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
  if (id === 'codex')
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
  if (id === 'agy')
    throw new Problem(422, 'provider_contract', 'Antigravity requires its isolated agent launcher');
  throw new Problem(422, 'provider_unknown', 'Unknown CLI provider');
}
export function parseProviderOutput(id: string, output: string): unknown {
  try {
    if (id === 'agy') {
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
      if (!Number.isFinite(result.usage?.input_tokens) || result.usage.input_tokens > 16000)
        throw new Problem(
          502,
          'provider_budget',
          'Antigravity exceeded the verified input envelope'
        );
      const response = result.response.trim();
      const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(response);
      return JSON.parse(fenced ? fenced[1]! : response);
    }
    if (id === 'codex') {
      const events = output
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const message = events
        .filter((e) => e.type === 'item.completed' && e.item?.type === 'agent_message')
        .at(-1);
      if (!message) throw new Error('missing');
      return JSON.parse(message.item.text);
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
