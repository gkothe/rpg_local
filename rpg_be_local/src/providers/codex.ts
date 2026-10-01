import { lstat, link, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { Problem } from '../errors.js';
import type { ProviderSettings } from '../domain/types.js';
import type { Executable } from './discovery.js';
import type { ModelOption } from './service.js';
import { runProcess } from './processRunner.js';

export const CODEX_ISOLATED_VERSION = '0.159.2';
export const CODEX_INPUT_TOKENS = 8000;
const narrator =
  'You are a tabletop RPG narrator. The supplied JSON is the entire campaign context. No tools or outside context.';
const metadataSchema = z.object({
  models: z
    .array(
      z
        .object({
          slug: z.string().regex(/^[\w./:-]{1,120}$/),
          display_name: z.string().max(100),
          visibility: z.string(),
          supported_reasoning_levels: z.array(z.object({ effort: z.string() }).passthrough()),
        })
        .passthrough()
    )
    .max(100),
});
const safeEfforts = ['low', 'medium', 'high', 'xhigh', 'max'];
export function codexHome(env: NodeJS.ProcessEnv): string {
  return env.CODEX_HOME ? path.resolve(env.CODEX_HOME) : path.join(os.homedir(), '.codex');
}
export function codexEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const isolated = { ...env };
  for (const key of Object.keys(isolated)) {
    if (
      (/^CODEX_/i.test(key) && key !== 'CODEX_HOME') ||
      /API_KEY|AUTH_TOKEN|OAUTH_TOKEN|OPENAI_BASE_URL|OPENAI_ORG_ID|OPENAI_PROJECT_ID/i.test(key)
    )
      delete isolated[key];
  }
  return isolated;
}
export function parseCodexCatalog(value: unknown): { models: ModelOption[]; metadata: unknown } {
  const catalog = metadataSchema.parse(value);
  const models = catalog.models
    .filter((model) => model.visibility === 'list')
    .map((model) => ({
      id: model.slug,
      label: model.display_name,
      efforts: model.supported_reasoning_levels
        .map((level) => level.effort)
        .filter((effort) => safeEfforts.includes(effort)),
      inputTokens: CODEX_INPUT_TOKENS,
    }));
  return {
    models,
    metadata: {
      models: catalog.models.map((model) => ({
        ...model,
        tool_mode: 'direct',
        shell_type: 'disabled',
        apply_patch_tool_type: null,
        experimental_supported_tools: [],
        base_instructions: narrator,
        model_messages: null,
      })),
    },
  };
}
async function readCatalog(env: NodeJS.ProcessEnv) {
  const file = path.join(codexHome(env), 'models_cache.json');
  const info = await lstat(file);
  if (!info.isFile() || info.size > 2_000_000) throw new Error('Invalid model metadata');
  return parseCodexCatalog(JSON.parse(await readFile(file, 'utf8')));
}
async function requireSubscription(executable: Executable, env: NodeJS.ProcessEnv): Promise<void> {
  const file = path.join(codexHome(env), 'auth.json');
  try {
    if (!(await lstat(file)).isFile()) throw new Error('Not a native file');
    const status = await runProcess(
      executable.binary,
      [...executable.prefix, '-c', 'cli_auth_credentials_store="file"', 'login', 'status'],
      '',
      {
        env: codexEnvironment(env),
        timeoutMs: 8000,
        maxOutputBytes: 10000,
        captureDiagnosticOutput: true,
      }
    );
    if (!/logged in using chatgpt/i.test(status)) throw new Error('Not subscription auth');
  } catch {
    throw new Problem(
      503,
      'codex_login',
      'Log in to Codex using ChatGPT in its own terminal; isolated gameplay requires its native file-backed subscription login'
    );
  }
}
export async function inspectCodex(executable: Executable, env = process.env) {
  const version = (
    await runProcess(executable.binary, [...executable.prefix, '--version'], '', {
      env: codexEnvironment(env),
      timeoutMs: 8000,
      maxOutputBytes: 10000,
    })
  )
    .trim()
    .replace(/^codex-cli\s+/, '');
  if (version !== CODEX_ISOLATED_VERSION)
    throw new Problem(
      503,
      'codex_version',
      `Codex isolation is verified on ${CODEX_ISOLATED_VERSION}; installed version ${version.slice(0, 30)} is not supported yet`
    );
  await requireSubscription(executable, env);
  try {
    return { version, ...(await readCatalog(env)) };
  } catch {
    throw new Problem(
      503,
      'codex_catalog',
      'Codex local model metadata is missing or invalid; open the Codex CLI to refresh its account model list, then refresh diagnostics'
    );
  }
}

export function isolatedCodexConfig(
  catalogPath: string,
  instructionsPath: string
): Record<string, unknown> {
  return {
    model_catalog_json: catalogPath,
    model_instructions_file: instructionsPath,
    instructions: '',
    developer_instructions: '',
    model_provider: 'openai',
    cli_auth_credentials_store: 'file',
    project_doc_max_bytes: 0,
    include_permissions_instructions: false,
    include_collaboration_mode_instructions: false,
    include_apps_instructions: false,
    'skills.include_instructions': false,
    'agents.enabled': false,
    'tools.update_plan.enabled': false,
    'tools.experimental_request_user_input.enabled': false,
    web_search: 'disabled',
    'memories.use_memories': false,
    'memories.generate_memories': false,
    'features.skip_host_skill_discovery': true,
    'features.shell_tool': false,
    'features.shell_snapshot': false,
    'features.view_image': false,
    'features.hooks': false,
    'features.plugins': false,
    'features.apps': false,
    'features.multi_agent': false,
    'features.multi_agent_v2': false,
    'features.goals': false,
    'features.browser_use': false,
    'features.in_app_browser': false,
    'features.code_mode_host': false,
    'features.code_mode': false,
    'features.skill_search': false,
    'features.skill_mcp_dependency_install': false,
    'features.request_permissions_tool': false,
    'features.sleep_tool': false,
    'features.token_budget': false,
    'features.current_time_reminder': false,
    'features.send_message_to_user_async': false,
    suppress_unstable_features_warning: true,
  };
}
export function isolatedCodexArgs(
  settings: ProviderSettings,
  schemaPath: string,
  config: Record<string, unknown>
): string[] {
  const args = [
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
  ];
  for (const [key, value] of Object.entries(config))
    args.push('-c', `${key}=${JSON.stringify(value)}`);
  if (settings.effort) args.push('-c', `model_reasoning_effort=${JSON.stringify(settings.effort)}`);
  return [...args, '-'];
}
export async function generateCodex(
  executable: Executable,
  settings: ProviderSettings,
  prompt: string,
  schemaPath: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal
): Promise<string> {
  if (signal?.aborted) throw new Problem(409, 'cancelled', 'Request cancelled');
  const inspected = await inspectCodex(executable, env);
  const model = inspected.models.find((option) => option.id === settings.model);
  if (!model || (settings.effort && !model.efforts.includes(settings.effort)))
    throw new Problem(
      422,
      'codex_model',
      'Select a current Codex model and supported effort; automatic delegation efforts are excluded'
    );
  const home = codexHome(env);
  // Same-volume hardlink: the app never reads, copies or logs authentication contents.
  const isolatedHome = await mkdtemp(path.join(home, 'rpg-isolated-'));
  try {
    try {
      if (!(await lstat(path.join(home, 'auth.json'))).isFile())
        throw new Error('Not a native auth file');
      await link(path.join(home, 'auth.json'), path.join(isolatedHome, 'auth.json'));
    } catch {
      throw new Problem(
        503,
        'codex_auth_link',
        'Codex isolated login needs a native file-backed auth file on a filesystem supporting hardlinks; check local Codex installation permissions'
      );
    }
    const catalogPath = path.join(cwd, 'codex-models.json');
    const instructionsPath = path.join(cwd, 'codex-instructions.txt');
    await writeFile(catalogPath, JSON.stringify(inspected.metadata), 'utf8');
    await writeFile(instructionsPath, narrator, 'utf8');
    return await runProcess(
      executable.binary,
      [
        ...executable.prefix,
        ...isolatedCodexArgs(
          settings,
          schemaPath,
          isolatedCodexConfig(catalogPath, instructionsPath)
        ),
      ],
      prompt,
      {
        cwd,
        env: { ...codexEnvironment(env), CODEX_HOME: isolatedHome },
        signal,
        timeoutMs: 180000,
        maxOutputBytes: 2_000_000,
      }
    );
  } finally {
    await cleanIsolatedHome(home, isolatedHome);
  }
}

async function cleanIsolatedHome(home: string, isolatedHome: string): Promise<void> {
  if (
    path.dirname(isolatedHome) !== home ||
    !path.basename(isolatedHome).startsWith('rpg-isolated-')
  )
    throw new Problem(500, 'codex_cleanup', 'Isolated CLI cleanup path validation failed');
  await rm(isolatedHome, { recursive: true, force: true });
}
