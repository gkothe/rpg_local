import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { Store } from '../store.js';
import { Problem } from '../errors.js';
import type { Campaign, Turn } from '../domain/types.js';
import { CharacterType } from '../domain/options.js';
import { publicCampaign } from '../domain/playerProjection.js';
import { summaryTurns } from '../domain/context.js';
import { createPromptTrace, type PromptTraceContext } from '../providers/promptLog.js';
import {
  ADVANCEMENT_INSTRUCTIONS,
  ADVANCEMENT_LIMITS,
  AdvancementStatus as Status,
  AdvancementKind,
  AdvancementBasis,
  AdvancementOutcome,
  advancementDigest as digest,
  advancementProposalSchema,
  advancementTurnIdentity,
  type AdvancementProposal,
  type AdvancementAward,
} from '../domain/advancement.js';
import { RuleStore, ruleContext } from './ruleStore.js';
import { RuleLookup, ruleToolSchemas } from './ruleLookup.js';
import { RULE_TOOLS, type RuleTool, type RuleContext, RuleSystemKind } from '../domain/rules.js';
import type { Generator } from '../providers/service.js';
import type { GameplayToolDispatch } from '../providers/gameplayTools.js';
import { findRules } from '../providers/rulesFind.js';
import {
  freezeCampaignSources,
  campaignSourceCatalog,
  createCampaignSourceRecall,
  campaignSourceSearchSchema,
  campaignSourceGetSchema,
  type FrozenCampaignSources,
} from '../domain/campaignSourceRecall.js';

export type SavedAward = AdvancementAward & {
  id: string;
  recipientName: string;
  recipientType: string;
  currencyId: string;
};
type Capture = {
  campaign: Campaign;
  turns: Turn[];
  turnIdentities: Record<string, string>;
  rules: RuleContext;
  sources: FrozenCampaignSources;
  previousReviewId: string | null;
  previousSummary: string;
  previousPolicy: string | null;
  pendingObjectives: string[];
  previousAwards: unknown[];
  semanticDigest: string;
};
export type AdvancementReview = {
  id: string;
  campaignId: string;
  requestId: string;
  status: Status;
  imported: boolean;
  proposal: AdvancementProposal | null;
  originalProposal: AdvancementProposal | null;
  proposalDigest: string | null;
  adjustmentReason: string | null;
  awards: SavedAward[];
  safeError: string | null;
  createdAt: string;
  updatedAt: string;
  appliedAt: string | null;
  reviewedTurnIds: string[];
};
type ReviewRow = Record<string, unknown> & { capture: Capture };
const mapRow = (r: ReviewRow): AdvancementReview => ({
  id: r.id as string,
  campaignId: r.campaign_id as string,
  requestId: r.request_id as string,
  status: r.status as Status,
  imported: r.imported as boolean,
  proposal: r.proposal as AdvancementProposal | null,
  originalProposal: r.original_proposal as AdvancementProposal | null,
  proposalDigest: r.proposal_digest as string | null,
  adjustmentReason: r.adjustment_reason as string | null,
  awards: r.awards as SavedAward[],
  safeError: r.safe_error as string | null,
  createdAt: new Date(r.created_at as string).toISOString(),
  updatedAt: new Date(r.updated_at as string).toISOString(),
  appliedAt: r.applied_at ? new Date(r.applied_at as string).toISOString() : null,
  reviewedTurnIds: Object.keys(r.capture.turnIdentities),
});
const conflict = (detail: string) => new Problem(409, 'advancement_conflict', detail);
const semantic = (c: Campaign) =>
  digest({
    instructions: c.instructions,
    description: c.description,
    ruleSystemId: c.ruleSystemId ?? null,
    ruleResolution: c.ruleResolution ?? null,
    advancementPolicy: c.advancementPolicy ?? null,
    sources: freezeCampaignSources(c),
  });

export async function gameplayAdvancementContext(store: Store, c: Campaign, client: PoolClient) {
  if (!c.advancementPolicy?.manual) return undefined;
  const rows = await client.query(
    "SELECT id,proposal,awards FROM advancement_reviews WHERE campaign_id=$1 AND status='applied' ORDER BY applied_at,id",
    [c.id]
  );
  return {
    awards: rows.rows.flatMap((r) => r.awards),
    policy: rows.rows.at(-1)?.proposal?.progressionBasis ?? null,
  };
}

/** Dedicated progression ledger: no character values are ever written by this service. */
export class AdvancementService {
  private controllers = new Map<string, AbortController>();
  private rules: RuleStore;
  constructor(
    private store: Store,
    private generator: Generator
  ) {
    this.rules = new RuleStore(store);
  }
  private async row(
    campaignId: string,
    id: string,
    client?: PoolClient,
    lock = false
  ): Promise<ReviewRow> {
    const r = await (client ?? this.store.pool).query(
      'SELECT * FROM advancement_reviews WHERE campaign_id=$1 AND id=$2' +
        (lock ? ' FOR UPDATE' : ''),
      [campaignId, id]
    );
    if (!r.rows[0]) throw new Problem(404, 'advancement_not_found', 'Advancement review not found');
    return r.rows[0];
  }
  async status(campaignId: string, id: string) {
    await this.store.campaign(campaignId);
    return mapRow(await this.row(campaignId, id));
  }
  private async latest(campaignId: string, client?: PoolClient): Promise<ReviewRow | null> {
    const r = await (client ?? this.store.pool).query(
      "SELECT * FROM advancement_reviews WHERE campaign_id=$1 AND status='applied' ORDER BY applied_at DESC,id DESC LIMIT 1",
      [campaignId]
    );
    return r.rows[0] ?? null;
  }
  private async outstanding(campaignId: string, client?: PoolClient) {
    const turns = await this.store.activeTurns(campaignId, client);
    const covered = await (client ?? this.store.pool).query(
      'SELECT turn_id FROM advancement_coverage WHERE campaign_id=$1',
      [campaignId]
    );
    const ids = new Set(covered.rows.map((r) => r.turn_id));
    return turns.filter((t) => !ids.has(t.id) && !t.editingPending);
  }
  async list(campaignId: string, limit: number = ADVANCEMENT_LIMITS.listPage, offset = 0) {
    await this.store.campaign(campaignId);
    const r = await this.store.pool.query(
      'SELECT * FROM advancement_reviews WHERE campaign_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3',
      [campaignId, limit, offset]
    );
    return {
      reviews: r.rows.map(mapRow),
      outstandingTurnCount: (await this.outstanding(campaignId)).length,
      nextCursor: r.rows.length === limit ? String(offset + limit) : null,
    };
  }
  async summary(campaignId: string, client?: PoolClient) {
    const c = await this.store.campaign(campaignId, client);
    const rows = await (client ?? this.store.pool).query(
      "SELECT id,awards,applied_at,proposal FROM advancement_reviews WHERE campaign_id=$1 AND status='applied' ORDER BY applied_at,id",
      [campaignId]
    );
    const totals = new Map<
      string,
      {
        characterId: string;
        currencyId: string;
        systemLabel: string;
        unitLabel: string;
        kind: AdvancementKind;
        total: number;
      }
    >();
    const ledger: unknown[] = [];
    for (const row of rows.rows) {
      const review = row;
      for (const a of row.awards as SavedAward[]) {
        ledger.push({
          reviewId: row.id,
          appliedAt: new Date(row.applied_at).toISOString(),
          ...a,
          rewardSystem: (review.proposal as AdvancementProposal).rewardSystem,
        });
        const k = `${a.characterId}:${a.currencyId}`;
        const p = review.proposal as AdvancementProposal;
        const sum = totals.get(k) ?? {
          characterId: a.characterId,
          currencyId: a.currencyId,
          systemLabel: [p.rewardSystem.label, p.rewardSystem.editionLabel]
            .filter(Boolean)
            .join(' '),
          unitLabel: a.unitLabel,
          kind: a.kind,
          total: 0,
        };
        sum.total += a.amount ?? 1;
        if (!Number.isFinite(sum.total) || sum.total > Number.MAX_SAFE_INTEGER)
          throw new Problem(
            422,
            'advancement_total_overflow',
            'Award total is outside the supported numeric range'
          );
        totals.set(k, sum);
      }
    }
    return {
      players: c.characters
        .filter((x) => x.type === CharacterType.Player)
        .map((x) => ({
          characterId: x.id,
          totals: [...totals.values()].filter((t) => t.characterId === x.id),
        })),
      ledger,
      ledgerDigest: digest(rows.rows),
    };
  }
  async start(campaignId: string, requestId: string) {
    let launchOwner: string | null = null;
    const result = await this.store.transaction(async (client) => {
      const c = await this.store.campaign(campaignId, client, true);
      const replay = await client.query(
        'SELECT * FROM advancement_reviews WHERE campaign_id=$1 AND request_id=$2',
        [campaignId, requestId]
      );
      if (replay.rows[0]) return mapRow(replay.rows[0]);
      await this.store.assertIdle(campaignId, client);
      const active = await client.query(
        "SELECT id FROM advancement_reviews WHERE campaign_id=$1 AND status='ready' AND NOT imported",
        [campaignId]
      );
      if (active.rowCount) throw conflict('Apply or discard the existing proposal first');
      const turns = await this.outstanding(campaignId, client);
      if (!turns.length) return null;
      const rules = await this.rules.resolve(c, client);
      if (
        (rules.kind === RuleSystemKind.Library || freezeCampaignSources(c).sources.length) &&
        !this.generator.generateOwnedGameplay
      )
        throw new Problem(
          503,
          'advancement_tools_unavailable',
          'This provider cannot review supplied references with isolated lookup tools'
        );
      const previous = await this.latest(campaignId, client);
      const prior = await this.summary(campaignId, client);
      c.advancementPolicy = { manual: true };
      await this.store.save(c, client);
      const proposal = previous?.proposal as AdvancementProposal | null;
      const capture: Capture = {
        campaign: publicCampaign(c),
        turns,
        turnIdentities: Object.fromEntries(turns.map((t) => [t.id, advancementTurnIdentity(t)])),
        rules: ruleContext(rules),
        sources: freezeCampaignSources(c),
        previousReviewId: (previous?.id as string) ?? null,
        previousSummary: proposal?.cumulativeSummary ?? '',
        previousPolicy: proposal?.progressionBasis ?? null,
        pendingObjectives: proposal?.pendingObjectives ?? [],
        previousAwards: prior.ledger,
        semanticDigest: semantic(c),
      };
      const id = randomUUID();
      launchOwner = randomUUID();
      await client.query(
        "INSERT INTO advancement_reviews(id,campaign_id,request_id,status,owner,lease_until,capture) VALUES($1,$2,$3,'running',$4,now()+($5*interval '1 second'),$6)",
        [id, campaignId, requestId, launchOwner, ADVANCEMENT_LIMITS.leaseSeconds, capture]
      );
      return mapRow(await this.row(campaignId, id, client));
    });
    if (result?.status === Status.Running && launchOwner)
      this.launch(campaignId, result.id, launchOwner);
    return result;
  }
  private launch(campaignId: string, id: string, ownerToken: string) {
    const controller = new AbortController();
    this.controllers.set(id, controller);
    queueMicrotask(() => void this.run(campaignId, id, controller, ownerToken));
  }
  private async assertOwned(
    campaignId: string,
    id: string,
    ownerToken: string,
    client?: PoolClient
  ) {
    const r = await (client ?? this.store.pool).query(
      "SELECT 1 FROM advancement_reviews WHERE campaign_id=$1 AND id=$2 AND owner=$3 AND status='running' AND lease_until>now()",
      [campaignId, id, ownerToken]
    );
    if (!r.rowCount) throw conflict('Review execution is no longer active');
  }
  private async checkCapture(c: Campaign, row: ReviewRow, client: PoolClient) {
    const cap = row.capture;
    if (
      semantic(c) !== cap.semanticDigest ||
      (await this.latest(c.id, client))?.id !== (cap.previousReviewId ?? undefined)
    )
      throw conflict(
        'Campaign instructions, references or previous reviews changed; discard and review again'
      );
    const rules = ruleContext(await this.rules.resolve(c, client));
    if (digest(rules) !== digest(cap.rules))
      throw conflict('Selected rules changed; discard and review again');
    const active = new Map((await this.outstanding(c.id, client)).map((t) => [t.id, t]));
    for (const [id, identity] of Object.entries(cap.turnIdentities)) {
      const turn = active.get(id);
      if (!turn || advancementTurnIdentity(turn) !== identity)
        throw conflict(
          'Reviewed gameplay changed or was already covered; discard and review again'
        );
    }
  }
  private async validateOriginalEvidence(proposal: AdvancementProposal, id: string) {
    const reads = await this.store.pool.query(
      'SELECT id,tool,payload FROM advancement_reads WHERE review_id=$1',
      [id]
    );
    for (const evidence of proposal.ruleEvidence) {
      const receipt = reads.rows.find((r) => r.id === evidence.receiptId);
      const original =
        receipt?.tool === 'rules_get' && receipt.payload.view === 'text'
          ? receipt.payload.text
          : receipt?.tool === 'campaign_sources_get'
            ? receipt.payload.sourceSpan?.text
            : null;
      if (
        typeof original !== 'string' ||
        !original.includes(evidence.quote) ||
        original.indexOf(evidence.quote) !== original.lastIndexOf(evidence.quote)
      )
        throw new Problem(
          422,
          'advancement_rule_evidence',
          'Rule evidence must quote a unique saved original span'
        );
    }
    const evidenceTools = new Set(
      proposal.ruleEvidence.map((e) => reads.rows.find((r) => r.id === e.receiptId)?.tool)
    );
    const bases = [proposal.progressionBasisKind, ...proposal.awards.map((a) => a.basisKind)];
    if (
      bases.some(
        (k) =>
          (k === AdvancementBasis.Original && !evidenceTools.has('rules_get')) ||
          (k === AdvancementBasis.Campaign && !evidenceTools.has('campaign_sources_get'))
      )
    )
      throw new Problem(
        422,
        'advancement_rule_evidence',
        'Original and campaign rule bases require original evidence'
      );
  }
  private validateProposal(p: AdvancementProposal, cap: Capture) {
    const ids = new Set(Object.keys(cap.turnIdentities));
    for (const a of p.awards) {
      if (
        !cap.campaign.characters.some(
          (c) => c.id === a.characterId && c.type === CharacterType.Player
        )
      )
        throw new Problem(
          422,
          'advancement_recipient',
          'Award recipient must be a captured player character'
        );
      if (a.evidenceTurnIds.some((id) => !ids.has(id)))
        throw new Problem(
          422,
          'advancement_evidence',
          'Award evidence must reference unreviewed captured turns'
        );
    }
  }
  private async run(
    campaignId: string,
    id: string,
    controller: AbortController,
    ownerToken: string
  ) {
    const active = () => !controller.signal.aborted && this.controllers.get(id) === controller;
    const alive = async (client?: PoolClient) => {
      if (!active()) throw conflict('Review execution was cancelled or superseded');
      await this.assertOwned(campaignId, id, ownerToken, client);
      if (!active()) throw conflict('Review execution was cancelled or superseded');
    };

    const timer = setInterval(() => {
      if (!active()) return;
      void this.store.pool
        .query(
          "UPDATE advancement_reviews SET lease_until=now()+($4*interval '1 second') WHERE campaign_id=$1 AND id=$2 AND owner=$3 AND status='running' AND lease_until>now()",
          [campaignId, id, ownerToken, ADVANCEMENT_LIMITS.leaseSeconds]
        )
        .then((r) => {
          if (!r.rowCount) controller.abort();
        })
        .catch(() => controller.abort());
    }, ADVANCEMENT_LIMITS.heartbeatMs);
    try {
      const row = await this.row(campaignId, id);
      const cap = row.capture;
      const trace: PromptTraceContext = {
        executionId: randomUUID(),
        runId: id,
        campaignId,
        purpose: 'advancement_review',
      };
      trace.trace = await createPromptTrace('advancement_review', trace);
      const lookup = new RuleLookup();
      let batchNamespace = 0;
      const sourceRecall = createCampaignSourceRecall(cap.sources);
      const read = async (
        name: string,
        input: unknown,
        requestId: string
      ): Promise<Record<string, unknown>> => {
        requestId = `${batchNamespace}:${requestId}`;
        await alive();
        const argumentDigest = digest({ name, input });
        const old = await this.store.pool.query(
          'SELECT * FROM advancement_reads WHERE review_id=$1 AND request_id=$2',
          [id, requestId]
        );
        if (old.rows[0]) {
          if (old.rows[0].argument_digest !== argumentDigest)
            throw conflict('Lookup identity reused with different arguments');
          if (name === 'rules_search') {
            const rules = await this.rules.resolve(await this.store.campaign(campaignId));
            if (digest(ruleContext(rules)) !== digest(cap.rules))
              throw conflict('Rules changed during review');
            lookup.restoreSearch(rules, old.rows[0].payload);
          }
          return old.rows[0].payload;
        }
        const receiptId = randomUUID();
        let payload: Record<string, unknown>;
        if ((RULE_TOOLS as readonly string[]).includes(name)) {
          const rules = await this.rules.resolve(await this.store.campaign(campaignId));
          if (digest(ruleContext(rules)) !== digest(cap.rules))
            throw conflict('Rules changed during review');
          payload = {
            ...lookup.execute(rules, name as RuleTool, input, receiptId),
            ruleContext: cap.rules,
          };
        } else if (name === 'campaign_sources_search') payload = sourceRecall.search(input);
        else if (name === 'campaign_sources_get') payload = sourceRecall.get(input, receiptId);
        else
          throw new Problem(
            422,
            'advancement_tool_forbidden',
            'Only reference lookup tools are allowed'
          );
        await this.store.transaction(async (client) => {
          await this.row(campaignId, id, client, true);
          await alive(client);
          await client.query(
            'INSERT INTO advancement_reads(id,campaign_id,review_id,request_id,argument_digest,tool,payload) VALUES($1,$2,$3,$4,$5,$6,$7)',
            [receiptId, campaignId, id, requestId, argumentDigest, name, payload]
          );
        });
        return payload;
      };
      const tools: GameplayToolDispatch = async (name, input, requestId) =>
        name === 'rules_find'
          ? findRules(
              (tool, args, rid) => read(tool, args, rid),
              input,
              requestId,
              () => alive()
            )
          : read(name, input, String(requestId));
      const toolSchemas = {
        ...ruleToolSchemas,
        rules_find: ruleToolSchemas.rules_search,
        campaign_sources_search: campaignSourceSearchSchema,
        campaign_sources_get: campaignSourceGetSchema,
      };
      tools.definitions = Object.entries(toolSchemas).map(([name, schema]) => ({
        name,
        description:
          'Read reference material for advancement adjudication. Search metadata is navigation only.',
        inputSchema: z.toJSONSchema(schema) as { type: 'object'; [key: string]: unknown },
      }));
      const rules = await this.rules.resolve(await this.store.campaign(campaignId));
      const seed = {
        campaign: {
          name: cap.campaign.name,
          description: cap.campaign.description,
          instructions: cap.campaign.instructions,
          characters: cap.campaign.characters
            .filter((c) => c.type === CharacterType.Player)
            .map(({ notes: _notes, ...c }) => c),
        },
        selectedSystem: { ...cap.rules, instructions: rules.instructions },
        sourceCatalog: campaignSourceCatalog(cap.sources),
      };
      const schema = z.toJSONSchema(advancementProposalSchema);
      const capacity = await this.generator.capacity(cap.campaign.settings);
      // Soft batching target, never an AI output/deadline cap. A single large turn is still sent whole.
      const batchTarget = Math.max(
        1,
        capacity * 2 -
          Buffer.byteLength(
            JSON.stringify(seed) + JSON.stringify(schema) + ADVANCEMENT_INSTRUCTIONS,
            'utf8'
          )
      );
      const checkpoint = row.checkpoint as {
        processed: number;
        proposal: AdvancementProposal;
      } | null;
      let processed = checkpoint?.processed ?? 0;
      let proposal: AdvancementProposal | null = checkpoint?.proposal ?? null;
      while (processed < cap.turns.length) {
        batchNamespace = processed;
        await alive();
        const batch: Turn[] = [];
        let size = 0;
        for (const turn of cap.turns.slice(processed)) {
          const bytes = Buffer.byteLength(JSON.stringify(summaryTurns([turn])), 'utf8');
          if (batch.length && size + bytes > batchTarget) break;
          batch.push(turn);
          size += bytes;
        }
        const prompt = JSON.stringify({
          ...seed,
          previousSummary: proposal?.cumulativeSummary ?? cap.previousSummary,
          previousPolicy: proposal?.progressionBasis ?? cap.previousPolicy,
          pendingObjectives: proposal?.pendingObjectives ?? cap.pendingObjectives,
          previousAwards: [...cap.previousAwards, ...(proposal?.awards ?? [])],
          unreviewedTurns: summaryTurns(batch),
        });
        const raw = this.generator.generateOwnedGameplay
          ? await this.generator.generateOwnedGameplay(
              cap.campaign.settings,
              prompt,
              schema,
              ADVANCEMENT_INSTRUCTIONS,
              tools,
              controller.signal,
              trace
            )
          : await this.generator.generate(
              cap.campaign.settings,
              `${ADVANCEMENT_INSTRUCTIONS}\n${prompt}`,
              schema,
              controller.signal,
              trace
            );
        const part = advancementProposalSchema.parse(raw);
        await this.validateOriginalEvidence(part, id);
        this.validateProposal(part, {
          ...cap,
          turnIdentities: Object.fromEntries(batch.map((t) => [t.id, cap.turnIdentities[t.id]!])),
        });
        const needsGuidance =
          part.outcome === AdvancementOutcome.NeedsGuidance ||
          proposal?.outcome === AdvancementOutcome.NeedsGuidance;
        proposal = advancementProposalSchema.parse({
          ...part,
          outcome: needsGuidance ? AdvancementOutcome.NeedsGuidance : part.outcome,
          explanation: proposal
            ? `${proposal.explanation}\n${part.explanation}`.slice(0, ADVANCEMENT_LIMITS.textChars)
            : part.explanation,
          awards: needsGuidance ? [] : [...(proposal?.awards ?? []), ...part.awards],
          ruleEvidence: [...(proposal?.ruleEvidence ?? []), ...part.ruleEvidence],
        });
        processed += batch.length;
        await this.store.transaction(async (client) => {
          await this.row(campaignId, id, client, true);
          await alive(client);
          await client.query(
            'UPDATE advancement_reviews SET checkpoint=$2,updated_at=now() WHERE id=$1',
            [id, { processed, proposal }]
          );
        });
      }
      if (!proposal)
        throw new Problem(422, 'advancement_empty_capture', 'No captured turns to review');
      await this.validateOriginalEvidence(proposal, id);
      await this.store.transaction(async (client) => {
        const c = await this.store.campaign(campaignId, client, true);
        const locked = await this.row(campaignId, id, client, true);
        await alive(client);
        await this.checkCapture(c, locked, client);
        await client.query(
          "UPDATE advancement_reviews SET status='ready',owner=NULL,lease_until=NULL,proposal=$3,original_proposal=$3,proposal_digest=$4,updated_at=now() WHERE campaign_id=$1 AND id=$2",
          [campaignId, id, proposal, digest(proposal)]
        );
      });
    } catch (e) {
      if (!active()) return;
      await this.store.pool
        .query(
          "UPDATE advancement_reviews SET status='failed',owner=NULL,lease_until=NULL,safe_error=$4,updated_at=now() WHERE campaign_id=$1 AND id=$2 AND owner=$3 AND status='running'",
          [
            campaignId,
            id,
            ownerToken,
            e instanceof Problem
              ? e.message
              : e instanceof z.ZodError
                ? 'Provider returned an invalid advancement proposal. Resume or discard this review.'
                : 'Advancement generation failed. Verify provider configuration, then resume or discard.',
          ]
        )
        .catch((error) => {
          console.error(
            'Advancement failure could not be persisted',
            error instanceof Error ? error.name : 'unknown'
          );
        });
    } finally {
      clearInterval(timer);
      if (this.controllers.get(id) === controller) this.controllers.delete(id);
    }
  }
  async decide(
    campaignId: string,
    id: string,
    action: string,
    body: {
      requestId: string;
      proposalDigest?: string;
      proposal?: AdvancementProposal;
      adjustmentReason?: string;
    }
  ) {
    let resumeOwner: string | null = null;
    const identity = digest({ id, action, ...body });
    const result = await this.store.transaction(async (client) => {
      const c = await this.store.campaign(campaignId, client, true);
      const replay = await client.query(
        'SELECT * FROM advancement_decisions WHERE campaign_id=$1 AND request_id=$2',
        [campaignId, body.requestId]
      );
      if (replay.rows[0]) {
        if (replay.rows[0].digest !== identity)
          throw conflict('Request identity reused with different decision');
        return replay.rows[0].result as AdvancementReview;
      }
      const row = await this.row(campaignId, id, client, true);
      const review = mapRow(row);
      if (review.imported && ![Status.Applied, Status.Reversed].includes(review.status))
        throw conflict('Imported pending reviews are historical and cannot execute');
      if (action === 'cancel') {
        if (review.status !== Status.Running)
          throw conflict('Only running reviews can be cancelled');
        await client.query(
          "UPDATE advancement_reviews SET status='cancelled',owner=NULL,lease_until=NULL,updated_at=now() WHERE id=$1",
          [id]
        );
      } else if (action === 'discard') {
        if (
          ![Status.Ready, Status.Failed, Status.Interrupted, Status.Cancelled].includes(
            review.status
          )
        )
          throw conflict('This review cannot be discarded');
        await client.query(
          "UPDATE advancement_reviews SET status='discarded',updated_at=now() WHERE id=$1",
          [id]
        );
      } else if (action === 'resume') {
        if (![Status.Failed, Status.Interrupted, Status.Cancelled].includes(review.status))
          throw conflict('Only failed, interrupted or cancelled reviews can resume');
        await this.store.assertIdle(campaignId, client);
        await this.checkCapture(c, row, client);
        const active = await client.query(
          "SELECT id FROM advancement_reviews WHERE campaign_id=$1 AND status IN ('running','ready') AND NOT imported",
          [campaignId]
        );
        if (active.rowCount) throw conflict('Another review is active');
        await client.query(
          "UPDATE advancement_reviews SET status='running',owner=$2,lease_until=now()+($3*interval '1 second'),safe_error=NULL,updated_at=now() WHERE id=$1",
          [id, (resumeOwner = randomUUID()), ADVANCEMENT_LIMITS.leaseSeconds]
        );
      } else if (action === 'reverse') {
        await this.store.assertIdle(campaignId, client);
        if (review.status !== Status.Applied || (await this.latest(campaignId, client))?.id !== id)
          throw conflict('Reverse applied reviews newest first');
        await client.query(
          'DELETE FROM advancement_coverage WHERE campaign_id=$1 AND review_id=$2',
          [campaignId, id]
        );
        await client.query(
          "UPDATE advancement_reviews SET status='reversed',updated_at=now() WHERE id=$1",
          [id]
        );
      } else {
        if (review.status !== Status.Ready || review.proposalDigest !== body.proposalDigest)
          throw conflict('Proposal changed; reload before applying or editing');
        if (action === 'adjust') {
          const p = advancementProposalSchema.parse(body.proposal);
          this.validateProposal(p, row.capture);
          await client.query(
            'UPDATE advancement_reviews SET proposal=$2,proposal_digest=$3,adjustment_reason=$4,updated_at=now() WHERE id=$1',
            [id, p, digest(p), body.adjustmentReason]
          );
        } else if (action === 'apply') {
          await this.store.assertIdle(campaignId, client);
          await this.checkCapture(c, row, client);
          const p = advancementProposalSchema.parse(review.proposal);
          this.validateProposal(p, row.capture);
          if (p.outcome !== AdvancementOutcome.Reviewed)
            throw conflict('Resolve the requested guidance through direct edits before applying');
          const awards: SavedAward[] = p.awards.map((a) => {
            const character = c.characters.find(
              (x) => x.id === a.characterId && x.type === CharacterType.Player
            );
            if (!character) throw conflict('Award recipient is no longer a player character');
            return {
              ...a,
              id: randomUUID(),
              recipientName: character.name,
              recipientType: character.type,
              currencyId: digest({
                campaignId,
                system: p.rewardSystem.key,
                unit: a.unitKey,
                kind: a.kind,
              }),
            };
          });
          await client.query(
            "UPDATE advancement_reviews SET status='applied',awards=$2,applied_at=now(),updated_at=now() WHERE id=$1",
            [id, JSON.stringify(awards)]
          );
          for (const turnId of review.reviewedTurnIds)
            await client.query(
              'INSERT INTO advancement_coverage(campaign_id,turn_id,review_id) VALUES($1,$2,$3)',
              [campaignId, turnId, id]
            );
          await this.summary(campaignId, client);
        } else throw new Problem(422, 'advancement_action', 'Unknown advancement decision');
      }
      const saved = mapRow(await this.row(campaignId, id, client));
      await client.query(
        'INSERT INTO advancement_decisions(campaign_id,review_id,request_id,digest,result) VALUES($1,$2,$3,$4,$5)',
        [campaignId, id, body.requestId, identity, saved]
      );
      return saved;
    });
    if (action === 'cancel') {
      this.controllers.get(id)?.abort();
      this.controllers.delete(id);
    }
    if (action === 'resume' && result.status === Status.Running && resumeOwner)
      this.launch(campaignId, id, resumeOwner);
    return result;
  }
}
