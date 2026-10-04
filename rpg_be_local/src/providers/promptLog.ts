import { Problem } from '../errors.js';
import { operationalProblem } from '../processingErrors.js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { appRoot } from '../config.js';
import type { ProviderSettings } from '../domain/types.js';

export const promptLogDirectory = path.resolve(appRoot, '..', 'log');
export async function logPrompt(
  action: string,
  settings: ProviderSettings,
  prompt: string,
  systemInstructions?: string,
  directory = promptLogDirectory
): Promise<string> {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}__${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const name = action.replace(/[^a-zA-Z0-9_-]/g, '_');
  const content = JSON.stringify(
    {
      timestamp: now.toISOString(),
      action,
      ...settings,
      prompt,
      ...(systemInstructions !== undefined ? { systemInstructions } : {}),
    },
    null,
    2
  );
  try {
    await mkdir(directory, { recursive: true });
  } catch (error) {
    throw promptLogFailure(error);
  }
  for (let suffix = 0; ; suffix++) {
    const file = path.join(directory, `${stamp}__${name}${suffix ? `_${suffix + 1}` : ''}.json`);
    try {
      await writeFile(file, content, { encoding: 'utf8', flag: 'wx' });
      return file;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw promptLogFailure(error);
    }
  }
}

function promptLogFailure(error: unknown): Problem {
  const problem = operationalProblem(error);
  return new Problem(
    503,
    'prompt_log',
    `Prompt logging failed. ${problem.message} Check the application's log folder before retrying.`
  );
}
