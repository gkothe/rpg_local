import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RULE_LIMITS } from '../domain/rules.js';
import { Problem } from '../errors.js';
type PreviewEntry = { id: string; key: string; bytes: number; expiresAt: number; file: string };
export class RulePreview {
  private readonly entries = new Map<string, PreviewEntry>();
  private readonly ready: Promise<void>;
  constructor(
    readonly directory = path.join(os.tmpdir(), 'rpg-local-rule-previews'),
    readonly now: () => number = Date.now
  ) {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep))
      throw new Error('Preview staging must stay inside local temporary storage');
    this.ready = this.initialize();
  }
  private async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    for (const file of await readdir(this.directory, { withFileTypes: true })) {
      if (file.isFile() && /^[a-f0-9-]{36}\.json$/.test(file.name))
        await rm(path.join(this.directory, file.name));
    }
  }
  async expire(): Promise<void> {
    await this.ready;
    for (const entry of this.entries.values())
      if (entry.expiresAt <= this.now()) await this.cancel(entry.id);
  }
  async stage(
    key: string,
    value: unknown,
    backup = false
  ): Promise<{ id: string; expiresAt: string }> {
    await this.expire();
    const serialized = JSON.stringify(value);
    const bytes = Buffer.byteLength(serialized);
    if (bytes > (backup ? RULE_LIMITS.backupBytes : RULE_LIMITS.importBytes))
      throw new Problem(413, 'rules_preview_size', 'Preview content exceeds staging byte limit');
    const current = [...this.entries.values()];
    if (
      current.length >= RULE_LIMITS.previewsPerServer ||
      current.filter((entry) => entry.key === key).length >= RULE_LIMITS.previewsPerSystem ||
      current.reduce((sum, entry) => sum + entry.bytes, bytes) > RULE_LIMITS.stagedBytes
    )
      throw new Problem(429, 'rules_preview_quota', 'Preview staging quota exhausted');
    const id = randomUUID();
    const expiresAt = this.now() + RULE_LIMITS.previewTtlMs;
    const file = path.join(this.directory, `${id}.json`);
    const entry = { id, key, bytes, expiresAt, file };
    this.entries.set(id, entry);
    try {
      await writeFile(file, serialized, { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      this.entries.delete(id);
      throw error;
    }
    return { id, expiresAt: new Date(expiresAt).toISOString() };
  }
  async get<T>(id: string, key: string): Promise<T> {
    await this.expire();
    const entry = this.entries.get(id);
    if (!entry || entry.key !== key)
      throw new Problem(
        404,
        'rules_preview_missing',
        'Preview expired or does not belong to this system'
      );
    return JSON.parse(await readFile(entry.file, 'utf8')) as T;
  }
  async cancel(id: string): Promise<void> {
    await this.ready;
    const entry = this.entries.get(id);
    if (!entry) return;
    await rm(entry.file, { force: true });
    this.entries.delete(id);
  }
  async close(): Promise<void> {
    await this.ready;
    for (const id of this.entries.keys()) await this.cancel(id);
  }
}
