import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Store } from '../store.js';
import { newCampaign } from '../domain/campaign.js';
import type { Campaign, Archive, Snapshot, Memory } from '../domain/types.js';
import { Problem, conflict } from '../errors.js';
import { estimateTokens } from '../domain/context.js';
import { sourceSections } from '../domain/sourceSections.js';
import {
  ARCHIVE_TURN_STATUSES,
  CHARACTER_MUTABLE_FIELDS,
  CharacterType,
  CONTEXT_BUDGET_LIMITS,
  SourceKind,
  SourceStatus,
  TurnStatus,
} from '../domain/options.js';
import {
  MAX_ARCHIVE_TURNS,
  MAX_ENTITY_NAME_CHARS,
  MAX_MEMORY_TEXT_CHARS,
  MAX_SOURCE_PAGES,
  MAX_SOURCE_TEXT_CHARS,
} from '../domain/limits.js';
import {
  ARCHIVE_FORMAT_ID,
  ARCHIVE_FORMAT_VERSION,
  LEGACY_ARCHIVE_FORMAT_VERSION,
  DICE_GAMEPLAY_RESPONSE_SCHEMA_VERSION,
} from '../domain/versions.js';
import { DICE_LIMITS, diceRecordSchema, diceSessionSchema } from '../domain/dice.js';
import { rollInterpretationSchema, validateRollInterpretations } from '../domain/diceResponse.js';
import { diceDigest } from './dice.js';
const uuid = z.uuid();
const object = z.record(z.string(), z.unknown());
const character = z
  .object({
    id: uuid,
    name: z.string().min(1).max(MAX_ENTITY_NAME_CHARS),
    type: z.enum(CharacterType),
    attributes: object,
    inventory: object,
    description: object,
    notes: z.string(),
    revision: z.number().int().nonnegative(),
  })
  .strict();
const memory = z
  .object({
    id: uuid,
    text: z.string().max(MAX_MEMORY_TEXT_CHARS),
    coveredTurnIds: z.array(uuid),
    valid: z.boolean(),
    createdAt: z.iso.datetime(),
  })
  .strict();
const settings = z
  .object({
    provider: z.string().max(40),
    model: z.string().max(120),
    effort: z.string().max(20).nullable(),
  })
  .strict();
const campaign = z
  .object({
    id: uuid,
    name: z.string().min(1).max(MAX_ENTITY_NAME_CHARS),
    description: z.string(),
    instructions: z.string(),
    revision: z.number().int().nonnegative(),
    notes: z.string(),
    notesRevision: z.number().int().nonnegative(),
    characters: z.array(character).max(1000),
    sources: z
      .array(
        z
          .object({
            id: uuid,
            name: z.string(),
            kind: z.enum(SourceKind),
            text: z.string().max(MAX_SOURCE_TEXT_CHARS),
            status: z.enum(SourceStatus),
            version: z.number().int().positive(),
            pages: z.array(object).max(MAX_SOURCE_PAGES),
            warnings: z.array(z.string()),
            originalAvailable: z.boolean().optional(),
          })
          .strict()
      )
      .max(1000),
    settings,
    pinnedFacts: z.array(z.string()),
    pinnedSourceIds: z.array(uuid),
    pinnedSourceSections: z
      .array(
        z
          .object({
            sourceId: uuid,
            version: z.number().int().positive(),
            index: z.number().int().nonnegative(),
          })
          .strict()
      )
      .optional(),
    budgets: z
      .object({
        gameplay: z
          .number()
          .int()
          .min(CONTEXT_BUDGET_LIMITS.gameplay.min)
          .max(CONTEXT_BUDGET_LIMITS.gameplay.max),
        compaction: z
          .number()
          .int()
          .min(CONTEXT_BUDGET_LIMITS.compaction.min)
          .max(CONTEXT_BUDGET_LIMITS.compaction.max),
        memory: z
          .number()
          .int()
          .min(CONTEXT_BUDGET_LIMITS.memory.min)
          .max(CONTEXT_BUDGET_LIMITS.memory.max),
      })
      .strict(),
    state: object,
    memory: memory.nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
const context = z
  .object({
    revision: z.number().int().nonnegative(),
    prompt: z.string(),
    estimatedTokens: z.number(),
    estimator: z.string(),
    sourceVersions: z.array(z.object({ id: uuid, version: z.number().int() })),
    historyIds: z.array(uuid),
    memoryId: uuid.nullable(),
  })
  .strict();
const turn = z
  .object({
    diceSessionId: uuid.optional(),
    retryOfTurnId: uuid.optional(),
    rolls: z.array(diceRecordSchema).max(DICE_LIMITS.slots).optional(),
    rollInterpretations: z.array(rollInterpretationSchema).max(DICE_LIMITS.slots).optional(),
    id: uuid,
    campaignId: uuid,
    requestId: uuid,
    status: z.enum(ARCHIVE_TURN_STATUSES),
    action: z.string(),
    narrative: z.string().nullable(),
    changes: z.array(z.string()),
    error: z.string().nullable(),
    undone: z.boolean(),
    settings,
    context: context.nullable(),
    createdAt: z.iso.datetime(),
    completedAt: z.iso.datetime().nullable(),
  })
  .strict();
const snapshot = z
  .object({
    turnId: uuid,
    beforeCharacters: z.array(character),
    afterCharacters: z.array(character),
    beforeState: object,
    afterState: object,
    beforeMemory: memory.nullable(),
    changedFields: z
      .array(
        z
          .object({
            characterId: uuid,
            fields: z.array(z.enum(CHARACTER_MUTABLE_FIELDS)),
          })
          .strict()
      )
      .optional(),
  })
  .strict();
const archiveSchema = z
  .object({
    format: z.literal(ARCHIVE_FORMAT_ID),
    version: z.union([z.literal(LEGACY_ARCHIVE_FORMAT_VERSION), z.literal(ARCHIVE_FORMAT_VERSION)]),
    diceSessions: z.array(diceSessionSchema).max(MAX_ARCHIVE_TURNS).optional(),
    diceRecords: z
      .array(diceRecordSchema)
      .max(MAX_ARCHIVE_TURNS * DICE_LIMITS.slots)
      .optional(),
    campaign,
    turns: z.array(turn).max(MAX_ARCHIVE_TURNS),
    snapshots: z.array(snapshot),
    memories: z.array(memory),
  })
  .strict();
export function remapArchive(raw: unknown): Archive {
  const parsed = archiveSchema.parse(raw);
  if (
    parsed.version === LEGACY_ARCHIVE_FORMAT_VERSION &&
    ((parsed.diceSessions?.length ?? 0) ||
      (parsed.diceRecords?.length ?? 0) ||
      parsed.turns.some(
        (turn) =>
          turn.diceSessionId ||
          turn.retryOfTurnId ||
          turn.rolls?.length ||
          turn.rollInterpretations?.length
      ))
  )
    throw new Problem(422, 'archive_invalid', 'Legacy archives cannot contain dice sessions');
  const archive: Archive = {
    ...parsed,
    version: ARCHIVE_FORMAT_VERSION,
    diceSessions: parsed.diceSessions ?? [],
    diceRecords: parsed.diceRecords ?? [],
  };
  const old = archive.campaign;
  const ids = new Map<string, string>();
  const register = (id: string) => {
    if (ids.has(id)) throw new Problem(422, 'archive_invalid', 'Duplicate entity ID in archive');
    ids.set(id, randomUUID());
  };
  register(old.id);
  old.characters.forEach((c) => register(c.id));
  old.sources.forEach((s) => register(s.id));
  archive.turns.forEach((t) => register(t.id));
  archive.memories.forEach((m) => register(m.id));
  archive.diceSessions!.forEach((session) => register(session.id));
  archive.diceRecords!.forEach((record) => register(record.id));
  const tids = new Set(archive.turns.map((t) => t.id));
  const sids = new Set(old.sources.map((s) => s.id));
  const mids = new Set(archive.memories.map((m) => m.id));
  const nonCharacterIds = new Set([
    old.id,
    ...sids,
    ...tids,
    ...mids,
    ...archive.diceSessions!.map((session) => session.id),
    ...archive.diceRecords!.map((record) => record.id),
  ]);
  const activeIds = archive.turns
    .filter((t) => t.status === TurnStatus.Completed && !t.undone)
    .map((t) => t.id);
  const requestIds = new Set<string>();
  for (const t of archive.turns) {
    if (requestIds.has(t.requestId))
      throw new Problem(422, 'archive_invalid', 'Duplicate request ID in archive');
    requestIds.add(t.requestId);
    if (t.campaignId !== old.id)
      throw new Problem(422, 'archive_invalid', 'Cross-campaign turn reference');
    if (
      t.context &&
      (t.context.historyIds.some((id) => !tids.has(id)) ||
        (t.context.memoryId && !mids.has(t.context.memoryId)))
    )
      throw new Problem(422, 'archive_invalid', 'Unresolved context references');
    for (const source of t.context?.sourceVersions ?? []) {
      if (!ids.has(source.id)) ids.set(source.id, randomUUID());
    }
  }
  if (old.pinnedSourceIds.some((id) => !sids.has(id)) || (old.memory && !mids.has(old.memory.id)))
    throw new Problem(422, 'archive_invalid', 'Unresolved campaign reference');
  if (
    (old.pinnedSourceSections ?? []).some((pin) => {
      const source = old.sources.find(
        (source) =>
          source.id === pin.sourceId &&
          source.version === pin.version &&
          source.status === SourceStatus.Confirmed
      );
      return !source || !sourceSections(source)[pin.index];
    })
  )
    throw new Problem(422, 'archive_invalid', 'Unresolved current pinned section');
  for (const m of archive.memories) {
    if (m.coveredTurnIds.some((id) => !tids.has(id)))
      throw new Problem(422, 'archive_invalid', 'Unresolved memory turn coverage');
    if (estimateTokens(m.text) > old.budgets.memory)
      throw new Problem(422, 'archive_invalid', 'Oversized memory checkpoint');
    if (
      m.valid &&
      JSON.stringify(m.coveredTurnIds) !==
        JSON.stringify(activeIds.slice(0, m.coveredTurnIds.length))
    )
      throw new Problem(
        422,
        'archive_invalid',
        'Valid memory must cover a consecutive active-turn prefix'
      );
  }
  if (
    old.memory &&
    !archive.memories.some(
      (m) => m.id === old.memory!.id && m.valid && JSON.stringify(m) === JSON.stringify(old.memory)
    )
  )
    throw new Problem(422, 'archive_invalid', 'Current memory must match a valid saved checkpoint');
  const snapshotIds = new Set<string>();
  for (const snap of archive.snapshots) {
    if (snapshotIds.has(snap.turnId))
      throw new Problem(422, 'archive_invalid', 'Duplicate snapshot turn ID');
    snapshotIds.add(snap.turnId);
    if (!tids.has(snap.turnId))
      throw new Problem(422, 'archive_invalid', 'Unresolved undo turn reference');
    const snapshotCharacterIds = new Set(
      [...snap.beforeCharacters, ...snap.afterCharacters].map((char) => char.id)
    );
    for (const characters of [snap.beforeCharacters, snap.afterCharacters]) {
      if (new Set(characters.map((char) => char.id)).size !== characters.length)
        throw new Problem(422, 'archive_invalid', 'Duplicate snapshot character ID');
    }
    for (const char of [...snap.beforeCharacters, ...snap.afterCharacters]) {
      if (nonCharacterIds.has(char.id))
        throw new Problem(
          422,
          'archive_invalid',
          'Snapshot character ID collides with another entity'
        );
      if (!ids.has(char.id)) ids.set(char.id, randomUUID());
    }
    if (snap.changedFields?.some((change) => !snapshotCharacterIds.has(change.characterId)))
      throw new Problem(422, 'archive_invalid', 'Unresolved changed-field character reference');
    if (snap.beforeMemory && !mids.has(snap.beforeMemory.id))
      throw new Problem(422, 'archive_invalid', 'Unresolved snapshot memory reference');
  }
  const completed = archive.turns.filter((t) => t.status === TurnStatus.Completed && !t.undone);
  if (completed.some((t) => !archive.snapshots.some((s) => s.turnId === t.id)))
    throw new Problem(422, 'archive_invalid', 'Completed turn is missing its undo snapshot');
  const out = structuredClone(archive);
  const mapped = (id: string) => ids.get(id)!;
  for (const session of archive.diceSessions!)
    for (const id of session.characterIds) if (!ids.has(id)) ids.set(id, randomUUID());
  for (const session of archive.diceSessions!) {
    const root = archive.turns.find((turn) => turn.id === session.rootTurnId);
    if (
      session.campaignId !== old.id ||
      !tids.has(session.rootTurnId) ||
      root?.diceSessionId !== session.id ||
      root.retryOfTurnId ||
      new Set(session.characterIds).size !== session.characterIds.length ||
      session.characterIds.some((id) => !ids.has(id) || nonCharacterIds.has(id))
    )
      throw new Problem(422, 'archive_invalid', 'Unresolved dice session references');
    const records = archive
      .diceRecords!.filter((record) => record.sessionId === session.id)
      .sort((a, b) => a.slot - b.slot);
    if (
      records.length > DICE_LIMITS.slots ||
      records.some((record, index) => record.slot !== index) ||
      records.reduce(
        (sum, record) =>
          sum + record.groups.reduce((count, group) => count + group.faces.length, 0),
        0
      ) !== session.newFaces
    )
      throw new Problem(
        422,
        'archive_invalid',
        'Dice session slots or face totals are inconsistent'
      );
  }
  for (const record of archive.diceRecords!) {
    const session = archive.diceSessions!.find((session) => session.id === record.sessionId);
    if (
      record.campaignId !== old.id ||
      !session ||
      [record.actorId, record.targetId].some((id) => id && !session.characterIds.includes(id)) ||
      (record.rerollOf &&
        !archive.diceRecords!.some(
          (previous) =>
            previous.id === record.rerollOf!.rollId &&
            previous.sessionId === record.sessionId &&
            previous.slot < record.slot
        ))
    )
      throw new Problem(422, 'archive_invalid', 'Unresolved dice record references');
  }
  for (const turn of archive.turns) {
    const session = archive.diceSessions!.find((session) => session.id === turn.diceSessionId);
    const previous = archive.turns.find((previous) => previous.id === turn.retryOfTurnId);
    if (
      (turn.diceSessionId && !session) ||
      (turn.retryOfTurnId &&
        (!previous ||
          previous.diceSessionId !== turn.diceSessionId ||
          previous.createdAt >= turn.createdAt ||
          ![TurnStatus.Failed, TurnStatus.Cancelled, TurnStatus.Interrupted].includes(
            previous.status as TurnStatus
          )))
    )
      throw new Problem(422, 'archive_invalid', 'Unresolved dice attempt references');
    for (const [index, record] of (turn.rolls ?? []).entries()) {
      const canonical = archive.diceRecords!.find((canonical) => canonical.id === record.id);
      if (
        !session ||
        record.sessionId !== session.id ||
        record.slot !== index ||
        !canonical ||
        JSON.stringify(diceRecordSchema.parse(record)) !==
          JSON.stringify(diceRecordSchema.parse(canonical))
      )
        throw new Problem(
          422,
          'archive_invalid',
          'Turn dice must match its canonical session prefix'
        );
    }
    if (turn.status === TurnStatus.Completed && turn.diceSessionId)
      validateRollInterpretations(
        {
          version: DICE_GAMEPLAY_RESPONSE_SCHEMA_VERSION,
          narrative: turn.narrative ?? '',
          operations: [],
          rollInterpretations: turn.rollInterpretations ?? [],
        },
        (turn.rolls ?? []).map((record) => record.id)
      );
    if (
      (turn.rollInterpretations ?? []).some(
        (entry) => !(turn.rolls ?? []).some((record) => record.id === entry.rollId)
      )
    )
      throw new Problem(422, 'archive_invalid', 'Unresolved dice interpretation');
  }
  const remapRecord = (record: NonNullable<Archive['diceRecords']>[number]) => {
    record.id = mapped(record.id);
    record.sessionId = mapped(record.sessionId);
    record.campaignId = mapped(record.campaignId);
    if (record.actorId) record.actorId = mapped(record.actorId);
    if (record.targetId) record.targetId = mapped(record.targetId);
    if (record.rerollOf) record.rerollOf.rollId = mapped(record.rerollOf.rollId);
  };
  for (const session of out.diceSessions!) {
    session.id = mapped(session.id);
    session.campaignId = mapped(session.campaignId);
    session.rootTurnId = mapped(session.rootTurnId);
    session.characterIds = session.characterIds.map(mapped);
    session.imported = true;
  }
  for (const record of out.diceRecords!) remapRecord(record);
  out.campaign.id = mapped(old.id);
  for (const c of out.campaign.characters) c.id = mapped(c.id);
  for (const source of out.campaign.sources) {
    source.id = mapped(source.id);
    source.originalAvailable = false;
  }
  out.campaign.pinnedSourceIds = old.pinnedSourceIds.map(mapped);
  out.campaign.pinnedSourceSections = (old.pinnedSourceSections ?? []).map((pin) => ({
    ...pin,
    sourceId: mapped(pin.sourceId),
  }));
  const remapMemory = (m: Memory) => {
    m.id = mapped(m.id);
    m.coveredTurnIds = m.coveredTurnIds.map(mapped);
  };
  if (out.campaign.memory) remapMemory(out.campaign.memory);
  for (const m of out.memories) remapMemory(m);
  for (const t of out.turns) {
    t.rolls ??= [];
    t.rollInterpretations ??= [];
    if (t.diceSessionId) t.diceSessionId = mapped(t.diceSessionId);
    if (t.retryOfTurnId) t.retryOfTurnId = mapped(t.retryOfTurnId);
    for (const record of t.rolls ?? []) remapRecord(record);
    for (const entry of t.rollInterpretations ?? []) entry.rollId = mapped(entry.rollId);
    t.id = mapped(t.id);
    t.campaignId = out.campaign.id;
    t.requestId = randomUUID();
    if (t.context) {
      t.context.sourceVersions = t.context.sourceVersions.map((source) => ({
        ...source,
        id: mapped(source.id),
      }));
      t.context.historyIds = t.context.historyIds.map(mapped);
      if (t.context.memoryId) t.context.memoryId = mapped(t.context.memoryId);
      // Historical prompts are immutable audit text, never reused as provider input.
    }
  }
  for (const snapshot of out.snapshots) {
    snapshot.turnId = mapped(snapshot.turnId);
    for (const c of [...snapshot.beforeCharacters, ...snapshot.afterCharacters])
      c.id = mapped(c.id);
    if (snapshot.beforeMemory) remapMemory(snapshot.beforeMemory);
    for (const change of snapshot.changedFields ?? [])
      change.characterId = mapped(change.characterId);
  }
  out.campaign.createdAt = new Date().toISOString();
  out.campaign.updatedAt = out.campaign.createdAt;
  return out;
}
export class LibraryService {
  constructor(readonly store: Store) {}
  async listTemplates(kind: 'campaign' | 'character', limit: number, offset: number) {
    const table = kind === 'campaign' ? 'templates' : 'character_templates';
    const result = await this.store.pool.query(
      `SELECT document FROM ${table} ORDER BY created_at DESC,id LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return result.rows.map((row) => row.document);
  }
  async deleteTemplate(kind: 'campaign' | 'character', id: string) {
    const table = kind === 'campaign' ? 'templates' : 'character_templates';
    await this.store.pool.query(`DELETE FROM ${table} WHERE id=$1`, [id]);
  }
  characterTemplate(input: {
    name: string;
    campaignId: string;
    characterId: string;
    revision: number;
  }) {
    return this.store.transaction(async (client) => {
      const c = await this.store.campaign(input.campaignId, client, true);
      if (c.revision !== input.revision) throw conflict('Campaign changed');
      const character = c.characters.find((character) => character.id === input.characterId);
      if (!character) throw new Problem(404, 'not_found', 'Character not found');
      const template = {
        id: randomUUID(),
        name: input.name,
        character: { ...character, notes: '', revision: 0 },
        createdAt: new Date().toISOString(),
      };
      await client.query('INSERT INTO character_templates(id,document) VALUES($1,$2)', [
        template.id,
        template,
      ]);
      return template;
    });
  }
  instantiateCharacter(id: string, templateId: string, revision: number) {
    return this.store.edit(id, revision, async (c, client) => {
      const result = await client.query('SELECT document FROM character_templates WHERE id=$1', [
        templateId,
      ]);
      if (!result.rows[0]) throw new Problem(404, 'not_found', 'Character template not found');
      c.characters.push({
        ...result.rows[0].document.character,
        id: randomUUID(),
        notes: '',
        revision: 0,
      });
    });
  }
  async export(id: string): Promise<Archive> {
    return this.store.transaction(async (client) => {
      const c = await this.store.campaign(id, client, true);
      await this.store.assertIdle(id, client);
      const turns = (await this.store.turns(id, client, MAX_ARCHIVE_TURNS)).map(
        ({ diceRetry: _diceRetry, ...turn }) => turn
      );
      const snaps = await client.query('SELECT document FROM snapshots WHERE campaign_id=$1', [id]);
      const memories = await client.query(
        'SELECT document FROM memories WHERE campaign_id=$1 ORDER BY created_at',
        [id]
      );
      const sessions = await client.query(
        'SELECT * FROM dice_sessions WHERE campaign_id=$1 ORDER BY created_at,id',
        [id]
      );
      const records = await client.query(
        'SELECT * FROM dice_records WHERE campaign_id=$1 ORDER BY session_id,slot',
        [id]
      );
      return {
        format: ARCHIVE_FORMAT_ID,
        version: ARCHIVE_FORMAT_VERSION,
        diceSessions: sessions.rows.map((row) => ({
          id: row.id,
          campaignId: row.campaign_id,
          rootTurnId: row.root_turn_id,
          contextDigest: row.context_digest,
          frozenPrompt: row.frozen_prompt,
          frozenRevision: row.frozen_revision,
          characterIds: row.character_ids,
          imported: row.imported,
          newFaces: row.new_faces,
          createdAt: new Date(row.created_at).toISOString(),
        })),
        diceRecords: records.rows.map((row) => ({
          ...row.input,
          id: row.id,
          campaignId: row.campaign_id,
          sessionId: row.session_id,
          groups: row.groups,
          createdAt: new Date(row.created_at).toISOString(),
        })),
        campaign: c,
        turns,
        snapshots: snaps.rows.map((r) => r.document as Snapshot),
        memories: memories.rows.map((r) => r.document as Memory),
      };
    });
  }
  async import(raw: unknown): Promise<Campaign> {
    const archive = remapArchive(raw);
    return this.store.transaction(async (client) => {
      await this.store.insert(archive.campaign, client);
      for (const t of archive.turns)
        await client.query(
          'INSERT INTO turns(id,campaign_id,request_id,payload_hash,status,document,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [t.id, archive.campaign.id, t.requestId, 'imported', t.status, t, t.createdAt]
        );
      for (const s of archive.snapshots)
        await client.query('INSERT INTO snapshots(turn_id,campaign_id,document) VALUES($1,$2,$3)', [
          s.turnId,
          archive.campaign.id,
          s,
        ]);
      for (const m of archive.memories)
        await client.query('INSERT INTO memories(id,campaign_id,document) VALUES($1,$2,$3)', [
          m.id,
          archive.campaign.id,
          m,
        ]);
      for (const session of archive.diceSessions ?? [])
        await client.query(
          'INSERT INTO dice_sessions(id,campaign_id,root_turn_id,context_digest,frozen_prompt,frozen_revision,character_ids,imported,new_faces,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,true,$8,$9)',
          [
            session.id,
            session.campaignId,
            session.rootTurnId,
            session.contextDigest,
            session.frozenPrompt,
            session.frozenRevision,
            JSON.stringify(session.characterIds),
            session.newFaces,
            session.createdAt,
          ]
        );
      for (const record of archive.diceRecords ?? []) {
        const { id, sessionId, campaignId, createdAt, groups, ...base } = record;
        const input = {
          ...base,
          groups: groups.map((group) => ({
            label: group.label,
            sides: group.sides,
            count: group.faces.length,
          })),
        };
        await client.query(
          'INSERT INTO dice_records(id,campaign_id,session_id,slot,spec_digest,input,groups,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            id,
            campaignId,
            sessionId,
            record.slot,
            diceDigest(input),
            input,
            JSON.stringify(groups),
            createdAt,
          ]
        );
      }
      await this.store.reindex(archive.campaign, client);
      return archive.campaign;
    });
  }
  async template(name: string, campaignId: string, revision: number) {
    return this.store.transaction(async (client) => {
      const c = await this.store.campaign(campaignId, client, true);
      if (c.revision !== revision)
        throw conflict('Campaign changed; refresh before saving template');
      await this.store.assertIdle(c.id, client);
      const setup = {
        name: c.name,
        description: c.description,
        instructions: c.instructions,
        characters: c.characters,
        sources: c.sources,
        settings: c.settings,
        pinnedFacts: c.pinnedFacts,
        pinnedSourceIds: c.pinnedSourceIds,
        pinnedSourceSections: c.pinnedSourceSections ?? [],
        budgets: c.budgets,
      };
      const t = { id: randomUUID(), name, setup, createdAt: new Date().toISOString() };
      await client.query('INSERT INTO templates(id,document) VALUES($1,$2)', [t.id, t]);
      return t;
    });
  }
  async instantiate(id: string, name?: string): Promise<Campaign> {
    return this.store.transaction(async (client) => {
      const r = await client.query('SELECT document FROM templates WHERE id=$1', [id]);
      if (!r.rows[0]) throw new Problem(404, 'not_found', 'Template not found');
      const template = r.rows[0].document;
      const c = { ...newCampaign({ name: name ?? template.name }), ...template.setup } as Campaign;
      c.id = randomUUID();
      if (name) c.name = name;
      const map = new Map<string, string>();
      c.characters = c.characters.map((char) => ({
        ...char,
        id: randomUUID(),
        notes: '',
        revision: 0,
      }));
      c.sources = c.sources.map((source) => {
        const next = randomUUID();
        map.set(source.id, next);
        return { ...source, id: next, originalAvailable: false };
      });
      c.pinnedSourceIds = c.pinnedSourceIds.map((id) => map.get(id)!);
      c.pinnedSourceSections = (c.pinnedSourceSections ?? []).map((pin) => ({
        ...pin,
        sourceId: map.get(pin.sourceId)!,
      }));
      await this.store.insert(c, client);
      await this.store.reindex(c, client);
      return c;
    });
  }
}
