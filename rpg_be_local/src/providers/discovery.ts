import { access, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import { constants } from 'node:fs';
import path from 'node:path';
import { Problem } from '../errors.js';
import { PROVIDER_ID, type ProviderId } from './options.js';

export type Executable = { binary: string; prefix: string[] };
type DiscoveryContext = {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  node: string;
};

// Resolve known native/JS entrypoints directly. Never execute or parse shell wrappers.
export async function locate(
  name: ProviderId,
  context: DiscoveryContext = {
    platform: process.platform,
    env: process.env,
    home: os.homedir(),
    node: process.execPath,
  }
): Promise<Executable | null> {
  const override = context.env[`RPG_${name.toUpperCase()}_BIN`];
  if (override) {
    if (/\.(cmd|ps1|bat)$/i.test(override))
      throw new Problem(
        503,
        'provider_setup',
        'Configure a native executable or JavaScript entrypoint, not a shell wrapper'
      );
    if (!path.isAbsolute(override))
      throw new Problem(503, 'provider_setup', 'CLI executable override must be an absolute path');
    try {
      if (!(await stat(override)).isFile()) throw new Error('Not a file');
    } catch {
      throw new Problem(503, 'provider_setup', 'Configured CLI executable does not exist');
    }
    return /\.m?js$/i.test(override)
      ? { binary: context.node, prefix: [override] }
      : { binary: override, prefix: [] };
  }

  const windows = context.platform === 'win32';
  const directories = (context.env.PATH ?? '')
    .split(windows ? ';' : ':')
    .map((dir) => dir.replace(/^"|"$/g, ''))
    .filter(Boolean);
  if (windows) {
    directories.push(path.dirname(context.node), path.join(context.home, '.local', 'bin'));
    if (context.env.APPDATA) directories.push(path.join(context.env.APPDATA, 'npm'));
    if (name === PROVIDER_ID.Claude) directories.push(path.join(context.home, '.claude', 'local'));
    if (name === PROVIDER_ID.Codex && context.env.LOCALAPPDATA) {
      const root = path.join(context.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
      try {
        const versions = [];
        for (const entry of await readdir(root, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const dir = path.join(root, entry.name);
          versions.push({ dir, modified: (await stat(dir)).mtimeMs });
        }
        versions.sort((a, b) => b.modified - a.modified || a.dir.localeCompare(b.dir));
        directories.push(root, ...versions.map((entry) => entry.dir));
      } catch {
        // A desktop installation is optional; continue with other known locations.
      }
    }
  }
  for (const dir of new Set(directories)) {
    const candidates: Executable[] = [
      { binary: path.join(dir, windows ? `${name}.exe` : name), prefix: [] },
    ];
    if (windows && name === PROVIDER_ID.Claude) {
      const root = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code');
      candidates.push(
        { binary: path.join(root, 'bin', 'claude.exe'), prefix: [] },
        { binary: context.node, prefix: [path.join(root, 'cli.js')] }
      );
    }
    if (windows && name === PROVIDER_ID.Codex)
      candidates.push({
        binary: context.node,
        prefix: [path.join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js')],
      });
    for (const candidate of candidates) {
      try {
        const target = candidate.prefix[0] ?? candidate.binary;
        if (!(await stat(target)).isFile()) continue;
        await access(target, windows ? undefined : constants.X_OK);
        return candidate;
      } catch {
        // Probe only known entrypoints; do not expose private paths in diagnostics.
      }
    }
  }
  return null;
}
