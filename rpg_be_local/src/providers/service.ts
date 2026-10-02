import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import { locate } from './discovery.js';
import {
  inspectCodex,
  generateCodex,
  CODEX_INPUT_TOKENS,
  CODEX_ISOLATED_VERSION,
} from './codex.js';
import path from 'node:path';
import { runProcess } from './processRunner.js';
import { parseProviderOutput, providerArgs } from './adapters.js';
import { Problem } from '../errors.js';
import type { ProviderSettings } from '../domain/types.js';
import type { GameplayToolDispatch, BookGameplayLimits } from './gameplayTools.js';
import { VERIFIED_BOOK_LIMITS } from './gameplayTools.js';
import { z } from 'zod';
import { generateCodexDice } from './codexDice.js';
import { CLAUDE_DICE_VERSION, generateClaudeDice } from './claudeDice.js';
import { DICE_CLI_LIMITS, type RollCallback } from './diceProtocol.js';
import { DICE_LIMITS } from '../domain/dice.js';
import {
  ANTIGRAVITY_DICE_PHASE_RESERVE_BYTES,
  generateAntigravityDice,
} from './antigravityDice.js';
import {
  ANTIGRAVITY_ISOLATED_VERSION,
  generateAntigravity,
  parseModelCatalog,
  modelSlug,
} from './antigravity.js';
import {
  MAX_PROVIDER_INPUT_TOKENS,
  MODEL_EFFORTS,
  PROVIDERS,
  PROVIDER_ID,
  PROVIDER_IDS,
  type ProviderId,
} from './options.js';
export type RulesCapability = {
  supported: boolean;
  reason: string | null;
  efforts?: string[];
  limits?: BookGameplayLimits;
};
export type ModelOption = {
  id: string;
  label: string;
  efforts: string[];
  inputTokens: number;
  dice?: { supported: boolean; reason: string | null };
  rules?: RulesCapability;
};
const CLAUDE_CLI_INPUT_TOKENS = 8000;
export type Provider = {
  id: ProviderId;
  name: string;
  available: boolean;
  supported: boolean;
  reason: string | null;
  version: string | null;
  models: ModelOption[];
  catalogProvenance: string;
  dice?: { supported: boolean; reason: string | null };
  rules?: RulesCapability;
};
export interface Generator {
  bookGameplayLimits?(settings: ProviderSettings): Promise<BookGameplayLimits>;
  generateBookGameplay?(
    settings: ProviderSettings,
    prompt: string,
    schema: unknown,
    tools: GameplayToolDispatch,
    signal?: AbortSignal
  ): Promise<unknown>;
  bookGameplayCapacity?(settings: ProviderSettings, ceiling?: number): Promise<number>;
  generate(
    settings: ProviderSettings,
    prompt: string,
    schema: unknown,
    signal?: AbortSignal
  ): Promise<unknown>;
  capacity(settings: ProviderSettings, ceiling?: number): Promise<number>;
  generateGameplay?(
    settings: ProviderSettings,
    prompt: string,
    roll: RollCallback,
    signal?: AbortSignal
  ): Promise<unknown>;
  gameplayCapacity?(settings: ProviderSettings, ceiling?: number): Promise<number>;
}
const configSchema = z.array(
  z.object({
    provider: z.enum(PROVIDER_IDS),
    models: z.array(
      z.object({
        id: z.string().regex(/^[\w./:-]{1,120}$/),
        label: z.string().max(100),
        efforts: z.array(z.enum(MODEL_EFFORTS)),
        inputTokens: z.number().int().min(2000).max(MAX_PROVIDER_INPUT_TOKENS),
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
  const efforts = levels.filter((level) => (MODEL_EFFORTS as readonly string[]).includes(level));
  return [...aliases.matchAll(/'([\w./:-]{1,120})'/g)].map((match) => ({
    id: match[1]!,
    label: `${match[1]![0]!.toUpperCase()}${match[1]!.slice(1)} (CLI alias)`,
    efforts,
    inputTokens: CLAUDE_CLI_INPUT_TOKENS,
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
    for (const { id, name } of PROVIDERS) {
      let executable = null;
      let help = '';
      let version: string | null = null;
      let discoveryFailure: string | null = null;
      try {
        executable = await locate(id);
        if (executable) {
          help = await runProcess(
            executable.binary,
            [...executable.prefix, ...(id === PROVIDER_ID.Codex ? ['exec', '--help'] : ['--help'])],
            '',
            { timeoutMs: 8000, maxOutputBytes: 100000, captureDiagnosticOutput: true }
          );
          this.locations.set(id, executable);
          version = 'Installed CLI; flags inspected';
        }
      } catch (error) {
        discoveryFailure = error instanceof Problem ? error.message : 'CLI discovery failed';
      }
      let codexModels: ModelOption[] = [];
      const codexDiceModels = new Set<string>();
      let claudeDiceVerified = false;
      if (id === PROVIDER_ID.Claude && executable && !discoveryFailure) {
        try {
          version = (
            await runProcess(executable.binary, [...executable.prefix, '--version'], '', {
              timeoutMs: 8000,
              maxOutputBytes: 10000,
            })
          )
            .trim()
            .split(/\s/)[0]!;
          claudeDiceVerified = version === CLAUDE_DICE_VERSION;
        } catch {
          claudeDiceVerified = false;
        }
      }
      let codexIsolated = false;
      if (id === PROVIDER_ID.Codex && executable && !discoveryFailure) {
        try {
          if (
            !['--ignore-user-config', '--ignore-rules', '--ephemeral', '--output-schema'].every(
              (flag) => help.includes(flag)
            )
          )
            throw new Problem(
              503,
              'codex_version',
              'Installed Codex lacks required isolation flags'
            );
          const inspected = await inspectCodex(executable);
          version = inspected.version;
          codexModels = inspected.models;
          const metadata = inspected.metadata as {
            models: { slug: string; context_window?: number }[];
          };
          for (const model of metadata.models) {
            if ((model.context_window ?? 0) >= DICE_CLI_LIMITS.contextTokens)
              codexDiceModels.add(model.slug);
          }
          codexIsolated = true;
        } catch (error) {
          discoveryFailure =
            error instanceof Problem ? error.message : 'Codex isolation setup failed';
        }
      }
      let antigravityModels: ModelOption[] = [];
      let agyIsolated = false;
      if (
        id === PROVIDER_ID.Antigravity &&
        executable &&
        !discoveryFailure &&
        help.includes('--agent')
      ) {
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
            version === ANTIGRAVITY_ISOLATED_VERSION &&
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
        (codexIsolated ||
          agyIsolated ||
          (id === PROVIDER_ID.Claude &&
            ['--safe-mode', '--no-session-persistence', '--tools', '--json-schema'].every((flag) =>
              help.includes(flag)
            )));
      const configuredModels = configured.find((x) => x.provider === id)?.models;
      const models =
        id === PROVIDER_ID.Codex
          ? (configuredModels
              ?.filter((option) => codexModels.some((model) => model.id === option.id))
              .map((option) => ({
                ...option,
                inputTokens: Math.min(option.inputTokens, CODEX_INPUT_TOKENS),
                efforts: option.efforts.filter((effort) =>
                  codexModels.find((model) => model.id === option.id)!.efforts.includes(effort)
                ),
              })) ?? codexModels)
          : (configuredModels ??
            (id === PROVIDER_ID.Claude && !discoveryFailure
              ? parseClaudeHelpCatalog(help)
              : antigravityModels));
      const reason =
        discoveryFailure ??
        (!executable
          ? 'CLI not found on PATH or known local installation paths; restart the app after installing or configure RPG_' +
            id.toUpperCase() +
            '_BIN'
          : !isolated
            ? 'Installed, but tool/customization isolation is not verified; gameplay disabled'
            : !models.length
              ? 'Configure verified models in RPG_MODEL_CATALOG before gameplay'
              : null);
      const diceModels = models.map((model) => {
        const supported =
          isolated &&
          ((id === PROVIDER_ID.Claude &&
            claudeDiceVerified &&
            parseClaudeHelpCatalog(help).some((alias) => alias.id === model.id)) ||
            (id === PROVIDER_ID.Codex && codexDiceModels.has(model.id)) ||
            (id === PROVIDER_ID.Antigravity &&
              agyIsolated &&
              antigravityModels.some((entry) => entry.id === model.id)));
        const rulesSupported =
          process.platform === 'win32' &&
          supported &&
          model.efforts.includes('medium') &&
          ((id === PROVIDER_ID.Claude &&
            version === CLAUDE_DICE_VERSION &&
            model.id === 'sonnet') ||
            (id === PROVIDER_ID.Codex &&
              version === CODEX_ISOLATED_VERSION &&
              model.id === 'gpt-5.6-sol'));
        return {
          ...model,
          rules: {
            supported: rulesSupported,
            reason: rulesSupported
              ? null
              : 'Book gameplay is verified only for Claude 2.1.232 sonnet medium and Codex 0.159.2 gpt-5.6-sol medium on Windows',
            efforts: rulesSupported ? ['medium'] : [],
            ...(rulesSupported ? { limits: VERIFIED_BOOK_LIMITS } : {}),
          },
          dice: {
            supported,
            reason: supported
              ? null
              : id === PROVIDER_ID.Claude
                ? claudeDiceVerified
                  ? 'Trusted dice is verified only for current CLI model aliases'
                  : `Trusted dice requires verified Claude CLI ${CLAUDE_DICE_VERSION}`
                : 'Trusted dice isolation or context budget is not verified for this model',
          },
        };
      });
      const diceSupported = diceModels.some((model) => model.dice.supported);
      const rulesSupported = diceModels.some((model) => model.rules.supported);
      result.push({
        id,
        name,
        available: !!executable,
        supported: isolated && models.length > 0,
        reason,
        version,
        models: diceModels,
        rules: {
          supported: rulesSupported,
          reason: rulesSupported
            ? null
            : 'Book gameplay is not verified for this installed CLI/model combination',
        },
        dice: {
          supported: diceSupported,
          reason: diceSupported
            ? null
            : id === PROVIDER_ID.Antigravity
              ? (reason ?? 'Trusted dice requires a model from the verified installed CLI catalog')
              : id === PROVIDER_ID.Codex
                ? (reason ??
                  'Trusted dice requires a verified account model with a sufficient context window')
                : (reason ??
                  (!claudeDiceVerified
                    ? `Trusted dice requires verified Claude CLI ${CLAUDE_DICE_VERSION}`
                    : null)),
        },
        catalogProvenance:
          id === PROVIDER_ID.Antigravity
            ? `Installed CLI model catalog; verified minimal agent on ${ANTIGRAVITY_ISOLATED_VERSION}; individual model entitlement is checked when used`
            : configured.some((entry) => entry.provider === id)
              ? 'Explicit local administrator catalog; CLI login and model entitlement require a real-turn test'
              : id === PROVIDER_ID.Codex
                ? `Installed account model metadata; verified empty-tool isolated CLI on ${CODEX_ISOLATED_VERSION}; subscription/model entitlement is checked when used`
                : id === PROVIDER_ID.Claude
                  ? 'Aliases and effort choices advertised by installed CLI help; model/effort entitlement is checked when used'
                  : 'Installed CLI; tool/customization isolation is not verified',
      });
    }
    this.cache = result;
    return result;
  }
  async capacity(settings: ProviderSettings, ceiling = MAX_PROVIDER_INPUT_TOKENS): Promise<number> {
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
        settings.provider === PROVIDER_ID.Antigravity
          ? await generateAntigravity(
              executable,
              {
                ...settings,
                model: modelSlug(
                  settings,
                  (await this.list())
                    .find((provider) => provider.id === PROVIDER_ID.Antigravity)!
                    .models.find((model) => model.id === settings.model)!.efforts
                ),
              },
              prompt,
              schema,
              dir,
              env,
              signal
            )
          : settings.provider === PROVIDER_ID.Codex
            ? await generateCodex(executable, settings, prompt, schemaPath, dir, env, signal)
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
  async gameplayCapacity(
    settings: ProviderSettings,
    ceiling = MAX_PROVIDER_INPUT_TOKENS
  ): Promise<number> {
    const capacity = await this.capacity(settings, ceiling);
    const provider = (await this.list()).find((option) => option.id === settings.provider)!;
    if (!provider.dice?.supported)
      throw new Problem(
        503,
        'dice_provider',
        provider.dice?.reason ?? 'Trusted dice is unavailable for this CLI'
      );
    const model = provider.models.find((model) => model.id === settings.model)!;
    if (!model.dice?.supported)
      throw new Problem(
        503,
        'dice_model',
        model.dice?.reason ?? 'Trusted dice is unavailable for this model'
      );
    if (settings.provider === PROVIDER_ID.Claude) {
      const executable = this.locations.get(settings.provider)!;
      const version = await runProcess(executable.binary, [...executable.prefix, '--version'], '', {
        timeoutMs: 8000,
        maxOutputBytes: 10000,
      });
      if (!version.startsWith(CLAUDE_DICE_VERSION + ' '))
        throw new Problem(
          503,
          'claude_dice_version',
          `Claude trusted dice requires verified CLI ${CLAUDE_DICE_VERSION}`
        );
    }
    return settings.provider === PROVIDER_ID.Antigravity
      ? Math.max(0, capacity - ANTIGRAVITY_DICE_PHASE_RESERVE_BYTES)
      : capacity;
  }
  async bookGameplayCapacity(
    settings: ProviderSettings,
    ceiling = MAX_PROVIDER_INPUT_TOKENS
  ): Promise<number> {
    await this.capacity(settings, ceiling);
    const provider = (await this.list()).find((option) => option.id === settings.provider)!;
    const model = provider.models.find((option) => option.id === settings.model)!;
    if (!provider.rules?.supported || !model.rules?.supported || !model.rules.limits)
      throw new Problem(
        503,
        'rules_provider_unavailable',
        model.rules?.reason ?? provider.rules?.reason ?? 'Book gameplay is not verified'
      );
    if (!model.rules.efforts?.includes(settings.effort ?? ''))
      throw new Problem(
        503,
        'rules_effort_unavailable',
        'Book gameplay is verified only with medium effort for this model'
      );
    await this.gameplayCapacity(settings, ceiling);
    // Schema and narrator are already included in book-mode context. Native
    // continuation reserves are bounded independently by the verified 24 calls.
    return Math.min(model.inputTokens, model.rules.limits!.promptBytes, ceiling);
  }
  async bookGameplayLimits(settings: ProviderSettings): Promise<BookGameplayLimits> {
    await this.bookGameplayCapacity(settings);
    return (await this.list())
      .find((provider) => provider.id === settings.provider)!
      .models.find((model) => model.id === settings.model)!.rules!.limits!;
  }
  async generateBookGameplay(
    settings: ProviderSettings,
    prompt: string,
    _schema: unknown,
    tools: GameplayToolDispatch,
    signal?: AbortSignal
  ): Promise<unknown> {
    const capacity = await this.bookGameplayCapacity(settings);
    if (Buffer.byteLength(prompt, 'utf8') > capacity)
      throw new Problem(
        422,
        'context_overflow',
        'Book gameplay prompt exceeds its verified reserve'
      );
    const executable = this.locations.get(settings.provider)!;
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rpg-rules-cli-'));
    const roll: RollCallback = async () => {
      throw new Problem(503, 'rules_dispatch', 'Use the owned gameplay registry');
    };
    try {
      const book = { dispatch: tools };
      if (settings.provider === PROVIDER_ID.Codex)
        return await generateCodexDice(
          executable,
          settings,
          prompt,
          dir,
          process.env,
          roll,
          signal,
          book
        );
      if (settings.provider === PROVIDER_ID.Claude)
        return await generateClaudeDice(
          executable,
          settings,
          prompt,
          dir,
          process.env,
          roll,
          signal,
          book
        );
      const model = (await this.list())
        .find((provider) => provider.id === settings.provider)!
        .models.find((model) => model.id === settings.model)!;
      return await generateAntigravityDice(
        executable,
        { ...settings, model: modelSlug(settings, model.efforts) },
        prompt,
        dir,
        process.env,
        roll,
        signal,
        book
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  async generateGameplay(
    settings: ProviderSettings,
    prompt: string,
    roll: RollCallback,
    signal?: AbortSignal
  ): Promise<unknown> {
    const capacity = await this.gameplayCapacity(settings);
    if (Buffer.byteLength(prompt, 'utf8') > capacity + DICE_LIMITS.transcriptBytes)
      throw new Problem(
        422,
        'context_overflow',
        'Gameplay prompt exceeds its reserved input budget'
      );
    const executable = this.locations.get(settings.provider)!;
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rpg-dice-cli-'));
    try {
      if (settings.provider === PROVIDER_ID.Codex)
        return await generateCodexDice(
          executable,
          settings,
          prompt,
          dir,
          process.env,
          roll,
          signal
        );
      if (settings.provider === PROVIDER_ID.Claude)
        return await generateClaudeDice(
          executable,
          settings,
          prompt,
          dir,
          process.env,
          roll,
          signal
        );
      if (settings.provider === PROVIDER_ID.Antigravity) {
        const model = (await this.list())
          .find((provider) => provider.id === PROVIDER_ID.Antigravity)!
          .models.find((model) => model.id === settings.model)!;
        return await generateAntigravityDice(
          executable,
          { ...settings, model: modelSlug(settings, model.efforts) },
          prompt,
          dir,
          process.env,
          roll,
          signal
        );
      }
      throw new Problem(503, 'dice_provider', 'Trusted dice is unavailable for this CLI');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
