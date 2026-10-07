import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { RuleStore, ruleContent, ruleContext } from './ruleStore.js';
import { RulePreview } from './rulePreview.js';
import {
  RULE_COLUMNS,
  RULE_LIMITS,
  RuleSystemKind,
  DEFAULT_RULE_SYSTEM_ID,
  DEFAULT_RULE_SYSTEM_KEY,
  canonicalRuleJson,
  ruleContentHash,
  ruleHashSchema,
  ruleSlugSchema,
  validateRuleContent,
  serializedBytes,
  emptyRuleColumns,
  type RuleContent,
  type RuleContext,
} from '../domain/rules.js';
import { Problem, conflict } from '../errors.js';
import { sheetLayoutSchema } from '../domain/sheetLayout.js';

const backupSchema = z
  .object({
    format: z.literal('local-rpg-rules'),
    system: z
      .object({
        systemKey: ruleSlugSchema,
        systemName: z.string().min(1).max(RULE_LIMITS.nameChars),
        kind: z.enum(RuleSystemKind),
        revision: z.number().int().positive(),
        contentHash: ruleHashSchema,
        sheetLayout: sheetLayoutSchema.optional(),
        content: z
          .object({
            instructions: z.string(),
            sources: z.array(z.unknown()),
            mapping: z.record(z.string(), z.unknown()),
            ...Object.fromEntries(
              RULE_COLUMNS.map((key) => [key, z.record(z.string(), z.unknown())])
            ),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();
type Restore = {
  backup: z.infer<typeof backupSchema>;
  systemId: string;
  base: RuleContext | null;
  inputHash: string;
};
export class RuleBackup {
  constructor(
    readonly rules: RuleStore,
    readonly previews: RulePreview
  ) {}
  async export(id: string) {
    const system = await this.rules.get(id);
    const { sheetLayout } = await this.rules.sheetLayout(id);
    const backup = {
      format: 'local-rpg-rules',
      system: {
        systemKey: system.systemKey,
        systemName: system.systemName,
        kind: system.kind,
        revision: system.revision,
        contentHash: system.contentHash,
        sheetLayout,
        content: ruleContent(system),
      },
    };
    if (serializedBytes(backup) > RULE_LIMITS.backupBytes)
      throw new Problem(413, 'rules_backup_size', 'Private backup exceeds its byte limit');
    return backup;
  }
  async preview(bytes: Uint8Array) {
    if (bytes.byteLength > RULE_LIMITS.backupBytes)
      throw new Problem(413, 'rules_backup_size', 'Private backup exceeds its byte limit');
    const started = Date.now();
    let backup: z.infer<typeof backupSchema>;
    try {
      const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (raw && typeof raw === 'object' && 'version' in raw)
        throw new Error('This backup was exported by an older app and can no longer be restored');
      backup = backupSchema.parse(raw);
      const { system } = backup;
      validateRuleContent(system.content as RuleContent, system.kind);
      if (
        (system.kind === RuleSystemKind.ModelKnowledge) !==
        (system.systemKey === DEFAULT_RULE_SYSTEM_KEY)
      )
        throw new Error('Default identity is protected');
      if (ruleContentHash(system.content as RuleContent) !== system.contentHash)
        throw new Error('Backup content hash does not match');
      if (Date.now() - started > RULE_LIMITS.validationDeadlineMs)
        throw new Error('Backup validation deadline exceeded');
    } catch (error) {
      throw new Problem(
        422,
        'rules_backup_invalid',
        error instanceof Error ? error.message : 'Invalid private backup'
      );
    }
    const existing = await this.rules.store.pool.query(
      'SELECT id FROM rule_systems WHERE system_key=$1',
      [backup.system.systemKey]
    );
    const base = existing.rows[0] ? ruleContext(await this.rules.get(existing.rows[0].id)) : null;
    const currentLayout = base ? (await this.rules.sheetLayout(base.systemId)).sheetLayout : null;
    const layoutDiffers =
      !!currentLayout &&
      backup.system.sheetLayout !== undefined &&
      canonicalRuleJson(currentLayout) !== canonicalRuleJson(backup.system.sheetLayout);
    const systemId = base?.systemId ?? randomUUID();
    const inputHash = createHash('sha256').update(canonicalRuleJson(backup)).digest('hex');
    const staged = await this.previews.stage(
      `backup:${backup.system.systemKey}`,
      { backup, base, systemId, inputHash } satisfies Restore,
      true
    );
    return {
      previewId: staged.id,
      expiresAt: staged.expiresAt,
      systemId,
      systemKey: backup.system.systemKey,
      systemName: backup.system.systemName,
      contentHash: backup.system.contentHash,
      revision: base?.revision ?? null,
      replacing: !!base,
      protectedDefault: systemId === DEFAULT_RULE_SYSTEM_ID,
      books: backup.system.content.sources.length,
      warnings: [
        'This private backup contains original book text. Keep it outside public repositories.',
        ...(base && base.contentHash !== backup.system.contentHash
          ? ['The existing local content differs; replacement requires explicit confirmation.']
          : []),
        ...(layoutDiffers
          ? ['The backup sheet layout replaces the existing local sheet layout.']
          : []),
      ],
    };
  }
  async confirm(input: {
    systemId: string;
    systemKey: string;
    previewId: string;
    revision: number | null;
    requestId: string;
    replace: boolean;
  }) {
    let staged: Restore | null = null;
    try {
      staged = await this.previews.get<Restore>(input.previewId, `backup:${input.systemKey}`);
    } catch (error) {
      if (!(error instanceof Problem && error.code === 'rules_preview_missing')) throw error;
    }
    const identity = {
      operation: 'backup',
      previewId: input.previewId,
      revision: input.revision,
      systemKey: input.systemKey,
      replace: input.replace,
    };
    const result = await this.rules.store.transaction(async (client) => {
      const prior = await this.rules.confirmation(
        input.systemId,
        input.requestId,
        identity,
        client
      );
      if (prior) return prior;
      if (!staged || staged.systemId !== input.systemId)
        throw conflict('Restore preview expired or does not match confirmation');
      if (staged.base && !input.replace)
        throw conflict('Explicitly confirm replacement of the existing system');
      if (!staged.base) {
        const inserted = await client.query(
          "INSERT INTO rule_systems(id,system_key,system_name,kind,content_hash,instructions) VALUES($1,$2,$3,$4,$5,'') ON CONFLICT(system_key) DO NOTHING RETURNING id",
          [
            input.systemId,
            staged.backup.system.systemKey,
            staged.backup.system.systemName,
            staged.backup.system.kind,
            ruleContentHash({ ...emptyRuleColumns(), instructions: '', sources: [], mapping: {} }),
          ]
        );
        if (!inserted.rows[0])
          throw conflict('System key appeared after preview; review a new restore preview');
      }
      const current = await this.rules.get(input.systemId, client, 'update');
      if (staged.base && current.kind !== staged.backup.system.kind)
        throw conflict('System changed after restore preview');
      const published = await this.rules.write(
        current,
        staged.backup.system.content as RuleContent,
        client,
        !!staged.base
      );
      if (staged.backup.system.sheetLayout)
        await this.rules.setSheetLayout(current.systemId, staged.backup.system.sheetLayout, client);
      await this.rules.saveConfirmation(
        current.systemId,
        input.requestId,
        identity,
        staged.inputHash,
        published,
        client
      );
      return published;
    });
    await this.previews.cancel(input.previewId);
    return result;
  }
}
