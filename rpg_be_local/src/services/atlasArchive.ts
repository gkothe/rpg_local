import type { Atlas } from '../domain/atlas.js';
import type { Archive } from '../domain/types.js';
import { Problem } from '../errors.js';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { atlasMutationSchema, validateAtlas } from '../domain/atlas.js';
import {
  atlasPreparedSchema,
  atlasPrepareSchema,
  atlasEvidenceSchema,
  AtlasPreparationStatus,
} from '../domain/atlasPreparation.js';
import {
  atlasImportInputSchema,
  atlasImportAcceptSchema,
  atlasImageDraftSchema,
  AtlasImportStatus,
  ATLAS_IMAGE_TYPES,
} from '../domain/atlasImport.js';
import { frozenAtlasSchema } from '../domain/atlasRecall.js';
import {
  mapAssetEvidenceSchema,
  sourceSpanSchema,
  validateKnowledgeEvidence,
  KnowledgeOrigin,
  type CampaignKnowledge,
} from '../domain/knowledge.js';
import { atlasImageInfo } from '../providers/atlasVision.js';
import { canonicalRuleJson } from '../domain/rules.js';
import { uploadBytes } from '../config.js';

const digest = (value: unknown) =>
  createHash('sha256').update(canonicalRuleJson(value)).digest('hex');
const settings = z
  .object({ provider: z.string(), model: z.string(), effort: z.string().nullable() })
  .strict();
const stamp = z.iso.datetime();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const atlasArchiveSchema = z
  .object({
    assets: z.array(
      z
        .object({
          id: z.uuid(),
          campaignId: z.uuid(),
          mime: z.enum(ATLAS_IMAGE_TYPES),
          bytes: z
            .string()
            .max(Math.ceil(uploadBytes / 3) * 4)
            .nullable(),
          contentHash: hash,
          playerSafe: z.boolean(),
          observations: z.array(mapAssetEvidenceSchema),
          createdAt: stamp,
        })
        .strict()
    ),
    preparations: z.array(
      z
        .object({
          id: z.uuid(),
          campaignId: z.uuid(),
          sessionId: z.uuid(),
          turnId: z.uuid(),
          ownerTurnId: z.uuid(),
          localKey: z.string(),
          argumentDigest: hash,
          frozenInput: z
            .object({
              input: atlasPrepareSchema,
              frozen: frozenAtlasSchema,
              evidence: atlasEvidenceSchema,
            })
            .strict(),
          providerSettings: settings,
          status: z.enum(AtlasPreparationStatus),
          result: atlasPreparedSchema.nullable(),
          safeError: z.string().nullable(),
          createdAt: stamp,
          updatedAt: stamp,
        })
        .strict()
    ),
    imports: z.array(
      z
        .object({
          id: z.uuid(),
          campaignId: z.uuid(),
          requestId: z.uuid(),
          digest: hash,
          assetId: z.uuid(),
          frozenInput: z
            .object({ input: atlasImportInputSchema, frozen: frozenAtlasSchema })
            .strict(),
          settings,
          status: z.enum(AtlasImportStatus),
          draft: atlasImageDraftSchema.nullable(),
          error: z.string().nullable(),
          decision: z
            .object({
              input: atlasImportAcceptSchema,
              result: z.object({ saved: z.boolean() }).strict(),
            })
            .strict()
            .nullable(),
          createdAt: stamp,
          updatedAt: stamp,
        })
        .strict()
    ),
    edits: z.array(
      z
        .object({
          campaignId: z.uuid(),
          requestId: z.uuid(),
          digest: hash,
          changes: atlasMutationSchema,
          result: z.object({ requestId: z.uuid(), saved: z.boolean() }).strict(),
          createdAt: stamp,
        })
        .strict()
    ),
  })
  .strict();
export type AtlasArchive = z.infer<typeof atlasArchiveSchema>;
export function atlasFrozenCollections(a: Archive) {
  return [
    ...a.turns.flatMap((t) => (t.context?.frozenAtlas ? [t.context.frozenAtlas] : [])),
    ...a.diceSessions.flatMap((s) => (s.frozenAtlas ? [s.frozenAtlas] : [])),
    ...(a.atlasData?.preparations ?? []).map((p) => p.frozenInput.frozen),
    ...(a.atlasData?.imports ?? []).map((p) => p.frozenInput.frozen),
  ];
}
export function validateAtlasArchive(a: Archive): void {
  const fail = (message: string): never => {
    throw new Problem(422, 'archive_invalid', message);
  };
  const data = a.atlasData,
    cid = a.campaign.id;
  const assets = new Map((data?.assets ?? []).map((x) => [x.id, x]));
  const observations = new Map<string, z.infer<typeof mapAssetEvidenceSchema>>();
  for (const asset of assets.values()) {
    if (asset.campaignId !== cid) fail('Foreign map asset');
    if (asset.bytes !== null) {
      const bytes = Buffer.from(asset.bytes, 'base64');
      if (
        bytes.toString('base64') !== asset.bytes ||
        atlasImageInfo(bytes).mime !== asset.mime ||
        createHash('sha256').update(bytes).digest('hex') !== asset.contentHash
      )
        fail('Map asset bytes/hash mismatch');
    }
    for (const o of asset.observations) {
      if (o.assetId !== asset.id || observations.has(o.observationId))
        fail('Invalid map observation identity');
      observations.set(o.observationId, o);
    }
  }
  const checkEvidence = (records: { evidence: CampaignKnowledge['evidence'] }[]) => {
    for (const r of records)
      for (const e of r.evidence)
        if (
          e.type === 'map_asset' &&
          canonicalRuleJson(observations.get(e.observationId)) !== canonicalRuleJson(e)
        )
          fail('Unresolved or changed map image observation');
  };
  const sourceSpans = [
    ...a.campaign.sources.map((source) => ({
      id: source.id,
      version: source.version,
      name: source.name,
      text: source.text,
      start: 0,
      end: source.text.length,
    })),
    ...a.turns.flatMap((t) => [
      ...(t.context?.sourceSpans ?? []),
      ...(t.sourceReads ?? []).flatMap((r) =>
        r.payload.sourceSpan ? [sourceSpanSchema.parse(r.payload.sourceSpan)] : []
      ),
    ]),
  ];
  const reads = new Map(a.turns.flatMap((t) => t.ruleReads ?? []).map((r) => [r.id, r]));
  const checkSpatialProvenance = (row: Atlas['frames'][number] | Atlas['routes'][number]) => {
    if ((row.origin === KnowledgeOrigin.Source) !== row.evidence.length > 0)
      fail('Spatial source provenance is inconsistent');
    for (const e of row.evidence) {
      const read = e.type === 'book' ? reads.get(e.citation.receiptId) : undefined;
      if (e.type === 'book' && !read) fail('Spatial book evidence needs an owned original receipt');
      validateKnowledgeEvidence(
        { origin: row.origin, evidence: [e] },
        {
          campaignId: cid,
          turnId: read?.turnId ?? cid,
          sourceSpans,
          ruleReads: read ? [read] : [],
          ...(read ? { ruleContext: read.context } : {}),
          mapObservations: [...observations.values()],
        }
      );
    }
  };
  const checkAtlas = (atlas: Atlas | undefined, knowledge: CampaignKnowledge[]) => {
    validateAtlas({ atlas, knowledge });
    for (const f of atlas?.frames ?? []) {
      if (f.privateAssetId && !assets.has(f.privateAssetId)) fail('Unknown private map asset');
      if (f.playerAssetId && !assets.get(f.playerAssetId)?.playerSafe)
        fail('Unreviewed player image');
    }
    for (const row of [...(atlas?.frames ?? []), ...(atlas?.routes ?? [])])
      checkSpatialProvenance(row);
    checkEvidence([...(atlas?.frames ?? []), ...(atlas?.routes ?? [])]);
  };
  checkAtlas(a.campaign.atlas, a.campaign.knowledge ?? []);
  const knowledge = [
    a.campaign.knowledge ?? [],
    ...a.snapshots.flatMap((s) => [s.beforeKnowledge ?? [], s.afterKnowledge ?? []]),
    ...a.diceSessions.flatMap((s) => [s.frozenKnowledge?.records ?? []]),
    ...a.turns.flatMap((t) => [t.context?.frozenKnowledge?.records ?? []]),
  ];
  // Knowledge snapshots store touched rows, while atlas snapshots store the whole graph.
  const historical = new Map(knowledge.flat().map((r) => [r.id, r]));
  for (const frozen of atlasFrozenCollections(a))
    for (const r of frozen.records) historical.set(r.id, r);
  const overlay = (rows: CampaignKnowledge[]) => [
    ...new Map([...historical.values(), ...rows].map((r) => [r.id, r])).values(),
  ];
  for (const s of a.snapshots) {
    checkAtlas(s.beforeAtlas, overlay(s.beforeKnowledge ?? []));
    checkAtlas(s.afterAtlas, overlay(s.afterKnowledge ?? []));
  }
  for (const frozen of atlasFrozenCollections(a)) {
    if (frozen.campaignId !== cid) fail('Foreign frozen map');
    checkAtlas(frozen.atlas, frozen.records);
    knowledge.push(frozen.records);
  }
  for (const records of knowledge) {
    checkEvidence(records);
    checkEvidence(records.flatMap((r) => r.attributions));
  }
  checkEvidence(a.turns.flatMap((t) => t.operationExplanations ?? []));
  const turns = new Map(a.turns.map((t) => [t.id, t]));
  const sessions = new Map(a.diceSessions.map((s) => [s.id, s]));
  for (const p of data?.preparations ?? []) {
    if (
      p.campaignId !== cid ||
      !turns.has(p.ownerTurnId) ||
      turns.get(p.turnId)?.diceSessionId !== p.sessionId ||
      sessions.get(p.sessionId)?.campaignId !== cid ||
      p.frozenInput.evidence.campaignId !== cid ||
      p.frozenInput.frozen.campaignId !== cid ||
      p.argumentDigest !== digest(p.frozenInput.input)
    )
      fail('Invalid cartographer ownership/input');
    if ((p.status === AtlasPreparationStatus.Ready) !== (p.result !== null))
      fail('Cartographer ready result mismatch');
    if (
      p.result &&
      (p.result.id !== p.id ||
        p.result.evidence.campaignId !== cid ||
        !turns.has(p.result.evidence.turnId))
    )
      fail('Foreign prepared geography receipt');
    for (const context of [p.frozenInput.evidence, ...(p.result ? [p.result.evidence] : [])]) {
      for (const read of context.ruleReads)
        if (canonicalRuleJson(reads.get(read.id)) !== canonicalRuleJson(read))
          fail('Cartographer evidence receipt differs from the owned original');
      checkEvidence([{ evidence: context.mapObservations ?? [] }]);
    }
    if (p.result)
      for (const provenance of [
        ...p.result.draft.places,
        ...(p.result.draft.changes.frames ?? []).map((f) => f.value),
        ...(p.result.draft.changes.routes ?? []).map((r) => r.value),
      ])
        validateKnowledgeEvidence(provenance, p.result.evidence);
  }
  for (const p of data?.imports ?? []) {
    if (
      p.campaignId !== cid ||
      !assets.has(p.assetId) ||
      p.frozenInput.input.requestId !== p.requestId ||
      p.digest !==
        digest({ input: p.frozenInput.input, contentHash: assets.get(p.assetId)!.contentHash })
    )
      fail('Invalid map import ownership/digest');
    if ((p.status === AtlasImportStatus.Applied) !== (p.decision !== null))
      fail('Map import acceptance mismatch');
  }
  for (const p of data?.edits ?? [])
    if (
      p.campaignId !== cid ||
      p.requestId !== p.result.requestId ||
      p.digest !== digest(p.changes)
    )
      fail('Map edit digest mismatch');
}
export function registerAtlasAudit(
  a: Archive,
  ids: Map<string, string>,
  register: (id: string) => void
) {
  for (const asset of a.atlasData?.assets ?? []) {
    register(asset.id);
    for (const o of asset.observations) register(o.observationId);
  }
  for (const p of a.atlasData?.preparations ?? []) {
    register(p.id);
    if (p.result)
      for (const id of [
        ...Object.values(p.result.bindings.places),
        ...Object.values(p.result.bindings.frames),
        ...p.result.bindings.routes,
      ])
        if (!ids.has(id)) register(id);
  }
  for (const p of a.atlasData?.imports ?? []) register(p.id);
}
export function remapAtlasAudit(
  a: Archive,
  mapped: (id: string) => string,
  ids: Map<string, string>
) {
  void mapped;
  const deep = <T>(v: T): T => {
    if (typeof v === 'string') return (ids.get(v) ?? v) as T;
    if (Array.isArray(v)) return v.map(deep) as T;
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) as T;
    return v;
  };
  if (!a.atlasData) return;
  a.atlasData = deep(a.atlasData);
  for (const p of a.atlasData.preparations) {
    p.argumentDigest = digest(p.frozenInput.input);
    if (p.status === AtlasPreparationStatus.Running) p.status = AtlasPreparationStatus.Interrupted;
  }
  for (const p of a.atlasData.imports) {
    p.digest = digest({
      input: p.frozenInput.input,
      contentHash: a.atlasData.assets.find((x) => x.id === p.assetId)!.contentHash,
    });
    if (p.status === AtlasImportStatus.Running) p.status = AtlasImportStatus.Interrupted;
  }
  for (const p of a.atlasData.edits) p.digest = digest(p.changes);
}
export async function exportAtlas(client: PoolClient, campaignId: string): Promise<AtlasArchive> {
  const assets = await client.query(
    'SELECT * FROM atlas_assets WHERE campaign_id=$1 ORDER BY created_at,id',
    [campaignId]
  );
  const preparations = await client.query(
    'SELECT * FROM atlas_preparations WHERE campaign_id=$1 ORDER BY created_at,id',
    [campaignId]
  );
  const imports = await client.query(
    'SELECT * FROM atlas_imports WHERE campaign_id=$1 ORDER BY created_at,id',
    [campaignId]
  );
  const edits = await client.query(
    'SELECT * FROM atlas_edits WHERE campaign_id=$1 ORDER BY created_at,request_id',
    [campaignId]
  );
  const date = (v: Date) => new Date(v).toISOString();
  return atlasArchiveSchema.parse({
    assets: assets.rows.map((r) => ({
      id: r.id,
      campaignId: r.campaign_id,
      mime: r.mime,
      bytes: r.bytes?.toString('base64') ?? null,
      contentHash: r.content_hash,
      playerSafe: r.player_safe,
      observations: r.observations,
      createdAt: date(r.created_at),
    })),
    preparations: preparations.rows.map((r) => ({
      id: r.id,
      campaignId: r.campaign_id,
      sessionId: r.session_id,
      turnId: r.turn_id,
      ownerTurnId: r.owner_turn_id,
      localKey: r.local_key,
      argumentDigest: r.argument_digest,
      frozenInput: r.frozen_input,
      providerSettings: r.provider_settings,
      status: r.status,
      result: r.result,
      safeError: r.safe_error,
      createdAt: date(r.created_at),
      updatedAt: date(r.updated_at),
    })),
    imports: imports.rows.map((r) => ({
      id: r.id,
      campaignId: r.campaign_id,
      requestId: r.request_id,
      digest: r.digest,
      assetId: r.asset_id,
      frozenInput: r.frozen_input,
      settings: r.settings,
      status: r.status,
      draft: r.draft,
      error: r.error,
      decision: r.decision,
      createdAt: date(r.created_at),
      updatedAt: date(r.updated_at),
    })),
    edits: edits.rows.map((r) => ({
      campaignId: r.campaign_id,
      requestId: r.request_id,
      digest: r.digest,
      changes: r.changes,
      result: r.result,
      createdAt: date(r.created_at),
    })),
  });
}
export async function importAtlas(client: PoolClient, data: AtlasArchive | undefined) {
  if (!data) return;
  for (const a of data.assets)
    await client.query(
      'INSERT INTO atlas_assets(id,campaign_id,mime,bytes,content_hash,player_safe,observations,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        a.id,
        a.campaignId,
        a.mime,
        a.bytes === null ? null : Buffer.from(a.bytes, 'base64'),
        a.contentHash,
        a.playerSafe,
        JSON.stringify(a.observations),
        a.createdAt,
      ]
    );
  for (const p of data.preparations)
    await client.query(
      'INSERT INTO atlas_preparations(id,campaign_id,session_id,turn_id,owner_turn_id,local_key,argument_digest,frozen_input,provider_settings,status,result,safe_error,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
      [
        p.id,
        p.campaignId,
        p.sessionId,
        p.turnId,
        p.ownerTurnId,
        p.localKey,
        p.argumentDigest,
        p.frozenInput,
        p.providerSettings,
        p.status,
        p.result,
        p.safeError,
        p.createdAt,
        p.updatedAt,
      ]
    );
  for (const p of data.imports)
    await client.query(
      'INSERT INTO atlas_imports(id,campaign_id,request_id,digest,asset_id,frozen_input,settings,status,draft,error,decision,created_at,updated_at,imported) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true)',
      [
        p.id,
        p.campaignId,
        p.requestId,
        p.digest,
        p.assetId,
        p.frozenInput,
        p.settings,
        p.status,
        p.draft,
        p.error,
        p.decision,
        p.createdAt,
        p.updatedAt,
      ]
    );
  for (const p of data.edits)
    await client.query(
      'INSERT INTO atlas_edits(campaign_id,request_id,digest,changes,result,created_at) VALUES($1,$2,$3,$4,$5,$6)',
      [p.campaignId, p.requestId, p.digest, p.changes, p.result, p.createdAt]
    );
}

export function atlasCollections(
  archive: Pick<Archive, 'campaign' | 'snapshots' | 'turns' | 'diceSessions'>
): Atlas[] {
  return [
    archive.campaign.atlas,
    ...archive.snapshots.flatMap((s) => [s.beforeAtlas, s.afterAtlas]),
    ...archive.turns.map((t) => t.context?.frozenAtlas?.atlas),
    ...archive.diceSessions.map((s) => s.frozenAtlas?.atlas),
  ].filter((a): a is Atlas => a !== undefined);
}
export function registerAtlasRecords(
  atlases: Atlas[],
  ids: Map<string, string>,
  register: (id: string) => void
) {
  const spatial = new Set<string>();
  for (const atlas of atlases) {
    for (const row of [...atlas.routes, ...atlas.frames]) {
      if (spatial.has(row.id)) continue;
      if (ids.has(row.id))
        throw new Problem(
          422,
          'archive_invalid',
          'Spatial identity collides with another archived entity'
        );
      register(row.id);
      spatial.add(row.id);
    }
  }
}
export function remapAtlas(atlas: Atlas, mapped: (id: string) => string) {
  for (const p of atlas.places) {
    p.placeId = mapped(p.placeId);
    if (p.parentPlaceId) p.parentPlaceId = mapped(p.parentPlaceId);
    if (p.placement) p.placement.frameId = mapped(p.placement.frameId);
  }
  const evidence = (rows: { evidence: CampaignKnowledge['evidence'] }[]) => {
    for (const r of rows)
      for (const e of r.evidence) {
        if (e.type === 'map_asset') {
          e.assetId = mapped(e.assetId);
          e.observationId = mapped(e.observationId);
        } else if (e.type === 'book') e.citation.receiptId = mapped(e.citation.receiptId);
        else e.sourceId = mapped(e.sourceId);
      }
  };
  for (const f of atlas.frames) {
    f.id = mapped(f.id);
    f.placeId = mapped(f.placeId);
    if (f.privateAssetId) f.privateAssetId = mapped(f.privateAssetId);
    if (f.playerAssetId) f.playerAssetId = mapped(f.playerAssetId);
  }
  for (const r of atlas.routes) {
    r.id = mapped(r.id);
    r.from = mapped(r.from);
    r.to = mapped(r.to);
    if (r.drawing) r.drawing.frameId = mapped(r.drawing.frameId);
  }
  evidence([...atlas.frames, ...atlas.routes]);
  if (atlas.position) atlas.position = mapped(atlas.position);
}
