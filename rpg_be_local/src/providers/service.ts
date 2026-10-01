import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import { locate } from './discovery.js';
import path from 'node:path';
import { runProcess } from './processRunner.js';
import { parseProviderOutput, providerArgs } from './adapters.js';
import { Problem } from '../errors.js';
import type { ProviderSettings } from '../domain/types.js';
import { z } from 'zod';
import { generateAntigravity, parseModelCatalog, modelSlug } from './antigravity.js';
export type ModelOption = { id: string; label: string; efforts: string[]; inputTokens: number };
export type Provider = {
  id: string;
  name: string;
  available: boolean;
  supported: boolean;
  reason: string | null;
  version: string | null;
  models: ModelOption[];
  catalogProvenance: string;
};
export interface Generator {
  generate(
    settings: ProviderSettings,
    prompt: string,
    schema: unknown,
    signal?: AbortSignal
  ): Promise<unknown>;
  capacity(settings: ProviderSettings, ceiling?: number): Promise<number>;
}
const configSchema = z.array(
  z.object({
    provider: z.enum(['claude', 'codex', 'agy']),
    models: z.array(
      z.object({
        id: z.string().regex(/^[\w./:-]{1,120}$/),
        label: z.string().max(100),
        efforts: z.array(z.enum(['low', 'medium', 'high', 'xhigh', 'max'])),
        inputTokens: z.number().int().min(2000).max(16000),
      })
    ),
  })
);
export function parseClaudeHelpCatalog(help: string): ModelOption[] {
  const description = (flag: string) =>
    help.match(
      new RegExp(`(?:^|\\n) {2}--${flag}\\b([\\s\\S]*?)(?=\\n {2}--|\\n {2}-\\w,|$)`)
    )?.[1] ?? '';
  const aliases = description('model').match(/alias[\s\S]*?\(e\.g\.([\s\S]*?)\)/)?.[1] ?? '';
  const levels =
    description('effort')
      .match(/\(([a-z,\s]+)\)/)?.[1]
      ?.split(',')
      .map((level) => level.trim()) ?? [];
  const efforts = levels.filter((level) =>
    ['low', 'medium', 'high', 'xhigh', 'max'].includes(level)
  );
  return [...aliases.matchAll(/'([\w./:-]{1,120})'/g)].map((match) => ({
    id: match[1]!,
    label: `${match[1]![0]!.toUpperCase()}${match[1]!.slice(1)} (CLI alias)`,
    efforts,
    inputTokens: 8000,
  }));
}
export class ProviderService implements Generator {
  private cache: Provider[] | null = null;
  private locations = new Map<string, { binary: string; prefix: string[] }>();
  async list(refresh = false): Promise<Provider[]> {
    if (this.cache && !refresh) return this.cache;
    let configured: z.infer<typeof configSchema> = [];
    if (process.env.RPG_MODEL_CATALOG) {
      try {
        configured = configSchema.parse(JSON.parse(process.env.RPG_MODEL_CATALOG));
      } catch {
        throw new Problem(
          503,
          'catalog_setup',
          'RPG_MODEL_CATALOG must be a valid JSON model catalog'
        );
      }
    }
    this.locations.clear();
    const result: Provider[] = [];
    for (const [id, name] of [
      ['claude', 'Claude Code'],
      ['codex', 'Codex'],
      ['agy', 'Antigravity'],
    ]) {
      let executable = null;
      let help = '';
      let version: string | null = null;
      let discoveryFailure: string | null = null;
      try {
        executable = await locate(id!);
        if (executable) {
          help = await runProcess(
            executable.binary,
            [...executable.prefix, ...(id === 'codex' ? ['exec', '--help'] : ['--help'])],
            '',
            { timeoutMs: 8000, maxOutputBytes: 100000, captureDiagnosticOutput: true }
          );
          this.locations.set(id!, executable);
          version = 'Installed CLI; flags inspected';
        }
      } catch (error) {
        discoveryFailure = error instanceof Problem ? error.message : 'CLI discovery failed';
      }
      let antigravityModels: ModelOption[] = [];
      let agyIsolated = false;
      if (id === 'agy' && executable && !discoveryFailure && help.includes('--agent')) {
        try {
          const notes = await runProcess(
            executable.binary,
            [...executable.prefix, 'changelog'],
            '',
            { timeoutMs: 8000, maxOutputBytes: 200000 }
          );
          version = notes.trim().split(/\r?\n/)[0]!.replace(/:$/, '');
          const hooks = JSON.parse(
            await runProcess(
              executable.binary,
              [...executable.prefix, '-p', '/hooks', '--output-format', 'json'],
              '',
              { timeoutMs: 8000, maxOutputBytes: 100000 }
            )
          );
          agyIsolated =
            version === '1.2.14' &&
            Array.isArray(hooks.command?.data?.hooks) &&
            hooks.command.data.hooks.length === 0;
          antigravityModels = parseModelCatalog(
            await runProcess(executable.binary, [...executable.prefix, 'models'], '', {
              timeoutMs: 15000,
              maxOutputBytes: 100000,
            })
          );
        } catch {
          agyIsolated = false;
        }
      }
      const isolated =
        !discoveryFailure &&
        (agyIsolated ||
          (id === 'claude' &&
            ['--safe-mode', '--no-session-persistence', '--tools', '--json-schema'].every((flag) =>
              help.includes(flag)
            )));
      const models =
        configured.find((x) => x.provider === id)?.models ??
        (id === 'claude' && !discoveryFailure ? parseClaudeHelpCatalog(help) : antigravityModels);
      const reason =
        discoveryFailure ??
        (!executable
          ? 'CLI not found on PATH or known local installation paths; restart the app after installing or configure RPG_' +
            id!.toUpperCase() +
            '_BIN'
          : !isolated
            ? 'Installed, but tool/customization isolation is not verified; gameplay disabled'
            : !models.length
              ? 'Configure verified models in RPG_MODEL_CATALOG before gameplay'
              : null);
      result.push({
        id: id!,
        name: name!,
        available: !!executable,
        supported: isolated && models.length > 0,
        reason,
        version,
        models,
        catalogProvenance:
          id === 'agy'
            ? 'Installed CLI model catalog; verified minimal agent on 1.2.14; individual model entitlement is checked when used'
            : configured.some((entry) => entry.provider === id)
              ? 'Explicit local administrator catalog; CLI login and model entitlement require a real-turn test'
              : id === 'claude'
                ? 'Aliases and effort choices advertised by installed CLI help; model/effort entitlement is checked when used'
                : 'Installed CLI; tool/customization isolation is not verified',
      });
    }
    this.cache = result;
    return result;
  }
  async capacity(settings: ProviderSettings, ceiling = 16000): Promise<number> {
    const provider = (await this.list()).find((p) => p.id === settings.provider);
    if (!provider?.supported)
      throw new Problem(
        503,
        'provider_unavailable',
        provider?.reason ?? 'Select an installed supported CLI'
      );
    const model = provider.models.find((m) => m.id === settings.model);
    if (!model)
      throw new Problem(422, 'model_unavailable', 'Select a verified model from provider options');
    if (settings.effort && !model.efforts.includes(settings.effort))
      throw new Problem(422, 'effort_unavailable', 'Effort is not supported for this model');
    // Reserve the CLI's separate schema envelope, narrator instruction and formatting.
    return Math.max(0, Math.min(model.inputTokens, ceiling) - 3200);
  }
  async generate(
    settings: ProviderSettings,
    prompt: string,
    schema: unknown,
    signal?: AbortSignal
  ): Promise<unknown> {
    const capacity = await this.capacity(settings);
    if (Buffer.byteLength(prompt, 'utf8') > capacity)
      throw new Problem(
        422,
        'context_overflow',
        'Final provider request exceeds its reserved input budget'
      );
    const executable = this.locations.get(settings.provider)!;
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rpg-cli-'));
    try {
      const schemaPath = path.join(dir, 'response.schema.json');
      await writeFile(schemaPath, JSON.stringify(schema), 'utf8');
      const env = { ...process.env };
      for (const key of Object.keys(env)) {
        if (
          /^(ANTHROPIC_API_KEY|OPENAI_API_KEY|OPENROUTER_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY|CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_BASE_URL|CLAUDE_CODE_USE_|CODEX_API_KEY)/.test(
            key
          )
        )
          delete env[key];
      }
      const output =
        settings.provider === 'agy'
          ? await generateAntigravity(
              executable,
              {
                ...settings,
                model: modelSlug(
                  settings,
                  (await this.list())
                    .find((provider) => provider.id === 'agy')!
                    .models.find((model) => model.id === settings.model)!.efforts
                ),
              },
              prompt,
              schema,
              dir,
              env,
              signal
            )
          : await runProcess(
              executable.binary,
              [
                ...executable.prefix,
                ...providerArgs(settings.provider, settings, schemaPath, schema),
              ],
              prompt,
              { cwd: dir, env, signal, timeoutMs: 180000, maxOutputBytes: 2_000_000 }
            );
      return parseProviderOutput(settings.provider, output);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
