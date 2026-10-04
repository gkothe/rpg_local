import { Problem } from '../errors.js';
import { operationalProblem, safeProcessingFailure } from '../processingErrors.js';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { appRoot } from '../config.js';
import type { ProviderSettings } from '../domain/types.js';

export const promptLogDirectory = path.resolve(appRoot, '..', 'log');
export type PromptTraceContext = {
  executionId: string;
  runId?: string;
  turnId?: string;
  campaignId?: string;
  correctionAttempt?: number;
  purpose?: string;
  trace?: PromptTrace;
};

export class PromptTrace {
  incomplete = false;
  private sequence = 0;
  private pending: Promise<void> = Promise.resolve();
  readonly context: Omit<PromptTraceContext, 'trace'>;
  constructor(
    readonly file: string,
    context: Omit<PromptTraceContext, 'trace'>
  ) {
    this.context = {
      executionId: context.executionId,
      runId: context.runId,
      turnId: context.turnId,
      campaignId: context.campaignId,
      correctionAttempt: context.correctionAttempt,
      purpose: context.purpose,
    };
  }
  async event(
    kind: string,
    payload: unknown = {},
    required = false,
    invocation?: Omit<PromptTraceContext, 'trace'>
  ): Promise<boolean> {
    let success = true;
    const row = {
      timestamp: new Date().toISOString(),
      ...this.context,
      ...invocation,
      sequence: ++this.sequence,
      kind,
      payload: sanitizeTracePayload(payload),
    };
    this.pending = this.pending.then(async () => {
      try {
        await appendFile(this.file, JSON.stringify(row) + '\n', 'utf8');
      } catch (error) {
        this.incomplete = true;
        success = false;
        if (required) throw promptLogFailure(error);
        console.error(
          JSON.stringify({
            event: 'prompt_trace_incomplete',
            executionId: this.context.executionId,
          })
        );
      }
    });
    const current = this.pending;
    // A mandatory pre-execution logging error must not poison later recovery events.
    this.pending = current.catch(() => {});
    await current;
    return success;
  }
}

function sanitizeTracePayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeTracePayload);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !/authorization|password|secret|credential|environment|stderr|headers|^(?:token|accessToken|authToken|bearerToken)$/i.test(
              key
            )
        )
        .map(([key, child]) => [key, sanitizeTracePayload(child)])
    );
  return value;
}

export async function createPromptTrace(
  action: string,
  context: Omit<PromptTraceContext, 'trace'>,
  directory = promptLogDirectory
): Promise<PromptTrace> {
  const name = action.replace(/[^a-zA-Z0-9_-]/g, '_');
  const pad = (n: number) => String(n).padStart(2, '0');
  const now = new Date();
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}__${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  try {
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, `${stamp}__${name}__${randomUUID()}.jsonl`);
    await writeFile(file, '', { flag: 'wx' });
    return new PromptTrace(file, context);
  } catch (error) {
    throw promptLogFailure(error);
  }
}

export async function traceEvent(
  context: PromptTraceContext | undefined,
  kind: string,
  payload: unknown = {},
  required = false
): Promise<void> {
  if (!context?.trace) return;
  const { trace, ...invocation } = context;
  await trace.event(kind, payload, required, invocation);
}

export function safeTraceFailure(error: unknown): ReturnType<typeof safeProcessingFailure> {
  const failure = safeProcessingFailure(error);
  if (failure.database) return failure;
  return { code: error instanceof Problem ? error.code : 'invalid_response' };
}
export async function logPrompt(
  action: string,
  settings: ProviderSettings,
  prompt: string,
  systemInstructions?: string,
  directory = promptLogDirectory,
  trace?: PromptTraceContext
): Promise<string> {
  await traceEvent(trace, 'native_request', { action, settings, prompt, systemInstructions }, true);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}__${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const name = action.replace(/[^a-zA-Z0-9_-]/g, '_');
  const content = JSON.stringify(
    {
      timestamp: now.toISOString(),
      action,
      ...settings,
      ...(trace
        ? {
            correlation: {
              executionId: trace.executionId,
              runId: trace.runId,
              turnId: trace.turnId,
              campaignId: trace.campaignId,
              correctionAttempt: trace.correctionAttempt,
              purpose: trace.purpose,
            },
          }
        : {}),
      prompt,
      ...(systemInstructions !== undefined ? { systemInstructions } : {}),
    },
    null,
    2
  );
  const readable = [
    '# Model prompt log',
    '',
    '## Settings',
    '',
    fencedText(
      JSON.stringify({ timestamp: now.toISOString(), action, ...settings }, null, 2),
      'json'
    ),
    ...(systemInstructions !== undefined
      ? ['', '## System instructions', '', fencedText(systemInstructions)]
      : []),
    '',
    '## Prompt',
    '',
    readablePrompt(prompt),
    '',
    'The matching .json file preserves the exact original strings. This file formats them for reading.',
    '',
  ].join('\n');
  try {
    await mkdir(directory, { recursive: true });
  } catch (error) {
    throw promptLogFailure(error);
  }
  for (let suffix = 0; ; suffix++) {
    const file = path.join(directory, `${stamp}__${name}${suffix ? `_${suffix + 1}` : ''}.json`);
    try {
      await writeFile(file, content, { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw promptLogFailure(error);
    }
    try {
      await writeFile(file.replace(/\.json$/, '.md'), readable, { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      throw promptLogFailure(error);
    }
    return file;
  }
}

function readablePrompt(prompt: string): string {
  let parsed: unknown;
  let continuation = '';
  try {
    parsed = JSON.parse(prompt);
  } catch {
    // Some adapters append transport instructions after a compact JSON prompt.
    const newline = prompt.indexOf('\n');
    if (newline === -1) return fencedText(prompt);
    try {
      parsed = JSON.parse(prompt.slice(0, newline));
      continuation = prompt.slice(newline + 1);
    } catch {
      // Ordinary prose and malformed JSON retain their original line breaks.
      return fencedText(prompt);
    }
  }
  return parsed !== null && typeof parsed === 'object'
    ? [
        fencedText(JSON.stringify(parsed, null, 2), 'json'),
        ...(continuation ? ['', fencedText(continuation)] : []),
      ].join('\n')
    : fencedText(prompt);
}

/** Use a longer fence than any backtick run in the logged content. */
function fencedText(content: string, language = 'text'): string {
  let length = 3;
  for (const match of content.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
  const fence = '`'.repeat(length);
  return `${fence}${language}\n${content}\n${fence}`;
}

function promptLogFailure(error: unknown): Problem {
  const problem = operationalProblem(error);
  return new Problem(
    503,
    'prompt_log',
    `Prompt logging failed. ${problem.message} Check the application's log folder before retrying.`
  );
}
