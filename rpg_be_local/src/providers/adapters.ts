import { cliFailure } from '../processingErrors.js';
import { Problem } from '../errors.js';
import { parseCodexPayload } from './codex.js';
import type { ProviderSettings } from '../domain/types.js';
import { PROVIDER_ID } from './options.js';
export function providerArgs(
  id: string,
  settings: ProviderSettings,
  schemaPath: string,
  schema: unknown
): string[] {
  if (id === PROVIDER_ID.Claude) {
    // Claude's schema validator does not register Zod's draft-2020-12 meta-schema.
    // The emitted constraints used here also work without this dialect annotation.
    const cliSchema = { ...(schema as Record<string, unknown>) };
    delete cliSchema.$schema;
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
      JSON.stringify(cliSchema),
      '--model',
      settings.model,
      ...(settings.effort ? ['--effort', settings.effort] : []),
      '--system-prompt',
      'You are a tabletop RPG narrator. The supplied JSON is the entire campaign context. No tools or outside context.',
    ];
  }
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
      return parseCodexPayload(messages[0].item.text);
    }
    const envelope = JSON.parse(output);
    if (envelope.is_error || envelope.error)
      throw cliFailure(
        typeof envelope.result === 'string'
          ? envelope.result
          : typeof envelope.error === 'string'
            ? envelope.error
            : ''
      );
    if (envelope.structured_output) return envelope.structured_output;
    if (typeof envelope.result === 'string') return JSON.parse(envelope.result);
    if (typeof envelope.response === 'string') return JSON.parse(envelope.response);
    if (typeof envelope.text === 'string') return envelope;
    throw new Error('missing');
  } catch (e) {
    if (e instanceof Problem) throw e;
    throw new Problem(502, 'provider_json', 'Local CLI did not return the required JSON response');
  }
}
