import { mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { runProcess } from '../providers/processRunner.js';
import { Problem } from '../errors.js';
import { appRoot, uploadBytes } from '../config.js';
import type { Source } from '../domain/types.js';
import { OCR_LANGUAGE_CODES, SourceKind, SourceStatus } from '../domain/options.js';
import { ocrLanguageSchema, transcriptionLanguageSchema } from '../domain/schemas.js';
import {
  MAX_SOURCE_PAGES,
  MAX_SOURCE_TEXT_BYTES,
  MAX_SOURCE_TEXT_CHARS,
} from '../domain/limits.js';
const MAX_AUDIO_SECONDS = 120;
const extractionSchema = z.object({
  text: z.string().min(1).max(MAX_SOURCE_TEXT_CHARS),
  pages: z.array(z.record(z.string(), z.unknown())).max(MAX_SOURCE_PAGES),
  warnings: z.array(z.string()),
});
export function textSource(
  name: string,
  text: string,
  kind: Source['kind'] = SourceKind.Text
): Source {
  if (!text.trim()) throw new Problem(422, 'source_empty', 'Source contains no text');
  if (Buffer.byteLength(text) > MAX_SOURCE_TEXT_BYTES)
    throw new Problem(413, 'source_limit', 'Extracted text exceeds 10MiB');
  return {
    id: randomUUID(),
    name,
    kind,
    text,
    status: SourceStatus.Confirmed,
    version: 1,
    pages: [],
    warnings: [],
  };
}
export async function extractFile(
  bytes: Buffer,
  name: string,
  language: (typeof OCR_LANGUAGE_CODES)[number] = OCR_LANGUAGE_CODES[0]
): Promise<Source> {
  if (!ocrLanguageSchema.safeParse(language).success)
    throw new Problem(422, 'ocr_language', 'Choose English, Portuguese, or both');
  if (bytes.length > uploadBytes) throw new Problem(413, 'upload_limit', 'File exceeds20MiB');
  const extension = path.extname(name).toLowerCase();
  if (extension !== '.pdf') {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new Problem(415, 'source_format', 'Use a UTF-8 text document or a valid PDF.');
    }
    for (const character of text) {
      const code = character.charCodeAt(0);
      if (code <= 8 || (code >= 14 && code <= 31))
        throw new Problem(
          415,
          'source_format',
          'Binary documents are unsupported; export as text or PDF.'
        );
    }
    return textSource(name, text, SourceKind.File);
  }
  if (extension !== '.pdf' || bytes.subarray(0, 5).toString() !== '%PDF-')
    throw new Problem(415, 'source_format', 'Use UTF-8 text, Markdown or a valid PDF');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rpg-source-'));
  try {
    const file = path.join(dir, 'input.pdf');
    await writeFile(file, bytes);
    const result = extractionSchema.parse(
      JSON.parse(
        await runProcess(
          process.env.RPG_PYTHON_BIN ?? 'python',
          [path.join(appRoot, 'python', 'extract.py'), file, language],
          '',
          { cwd: dir, timeoutMs: 120000, maxOutputBytes: 32 * 1024 * 1024 }
        )
      )
    );
    return {
      ...textSource(name, result.text, SourceKind.Pdf),
      pages: result.pages,
      warnings: result.warnings,
    };
  } catch (e) {
    if (e instanceof Problem)
      throw new Problem(
        e.status,
        'source_extraction',
        'PDF extraction failed; install local pypdfium2/Pillow and Tesseract with selected language data, then retry'
      );
    throw new Problem(
      422,
      'source_extraction',
      'PDF extraction failed; inspect input and local conversion setup'
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export function googleDocumentId(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Problem(422, 'source_url', 'Use a public Google Docs document URL');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'docs.google.com' ||
    parsed.port ||
    parsed.username ||
    parsed.password
  )
    throw new Problem(422, 'source_url', 'Only HTTPS docs.google.com documents are supported');
  const match = /^\/document\/d\/([A-Za-z0-9_-]{10,200})(?:\/|$)/.exec(parsed.pathname);
  if (!match)
    throw new Problem(
      422,
      'source_url',
      'Use a Google Docs document URL, not an arbitrary web address'
    );
  return match[1]!;
}
export async function extractGoogle(url: string, name = 'Google document'): Promise<Source> {
  const id = googleDocumentId(url);
  const response = await fetch(`https://docs.google.com/document/d/${id}/export?format=txt`, {
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
  }).catch(() => {
    throw new Problem(
      422,
      'source_fetch',
      'Document fetch failed; use a publicly accessible Google Doc or upload text'
    );
  });
  if (!response.ok || !response.body || response.headers.get('content-type')?.includes('html'))
    throw new Problem(422, 'source_fetch', 'Google Doc is unavailable or requires login');
  let size = 0;
  const chunks: Buffer[] = [];
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_SOURCE_TEXT_BYTES)
        throw new Problem(413, 'source_limit', 'Google document exceeds10MiB');
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel();
  }
  return textSource(name, Buffer.concat(chunks).toString('utf8'), SourceKind.GoogleDoc);
}
export async function audioDiagnostics(): Promise<{
  available: boolean;
  reason: string | null;
  maxSeconds: number;
}> {
  if (!process.env.RPG_WHISPER_MODEL_PATH)
    return {
      available: false,
      reason:
        'Configure local Faster-Whisper and a pre-downloaded RPG_WHISPER_MODEL_PATH; typing remains available',
      maxSeconds: MAX_AUDIO_SECONDS,
    };
  try {
    for (const file of ['model.bin', 'config.json', 'tokenizer.json'])
      await access(path.join(process.env.RPG_WHISPER_MODEL_PATH, file));
    await runProcess(
      process.env.RPG_PYTHON_BIN ?? 'python',
      ['-c', 'import faster_whisper; import av'],
      '',
      { timeoutMs: 10000, maxOutputBytes: 1000 }
    );
    return { available: true, reason: null, maxSeconds: MAX_AUDIO_SECONDS };
  } catch {
    return {
      available: false,
      reason: 'Local Python/Faster-Whisper/model setup is unavailable',
      maxSeconds: MAX_AUDIO_SECONDS,
    };
  }
}
export async function transcribe(bytes: Buffer, language: string): Promise<{ text: string }> {
  const parsedLanguage = transcriptionLanguageSchema.safeParse(language);
  if (!parsedLanguage.success)
    throw new Problem(422, 'audio_language', 'Choose English, Portuguese or Auto');
  if (!(await audioDiagnostics()).available)
    throw new Problem(
      503,
      'audio_setup',
      'Install local Faster-Whisper and configure its pre-downloaded model before dictating'
    );
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rpg-audio-'));
  try {
    const file = path.join(dir, 'recording');
    await writeFile(file, bytes);
    const output = await runProcess(
      process.env.RPG_PYTHON_BIN ?? 'python',
      [path.join(appRoot, 'python', 'transcribe.py'), file, parsedLanguage.data],
      '',
      { timeoutMs: 180000, maxOutputBytes: 100000 }
    );
    return z.object({ text: z.string().max(40000) }).parse(JSON.parse(output));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
