import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { Problem } from '../errors.js';
import { operationalProblem, reportProcessingFailure } from '../processingErrors.js';
import {
  createPromptTrace,
  safeTraceFailure,
  traceEvent,
  type PromptTraceContext,
} from '../providers/promptLog.js';
import type { Generator } from '../providers/service.js';
import {
  JOURNAL_CHECK_OUTCOME_OPTIONS,
  JOURNAL_JOB_STATUS_OPTIONS,
  JournalCheckOutcome,
  JournalDecision,
  JournalJobKind,
  JournalJobStatus,
  type JournalEntry,
  type JournalListQuery,
  type JournalPage,
} from '../domain/journal.js';
import {
  applyBackfill,
  applyCorrection,
  correctionProposalSchema,
  emptyStaged,
  journalChanged,
  stagedBackfillSchema,
  targetDigest,
  type StagedBackfill,
} from '../domain/journalChanges.js';
import {
  START_POSITION,
  backfillOutputJsonSchema,
  backfillPrompt,
  captureJournalInput,
  captureTarget,
  decisionOutputJsonSchema,
  decisionPrompt,
  gatherOutputJsonSchema,
  gatherPrompt,
  inputIdentity,
  nextBatch,
  reduceBackfill,
  reduceDecision,
  reduceGather,
  type BatchPosition,
  type CheckFinding,
  type FrozenJournalInput,
  type GatheredEvidence,
} from '../domain/journalGeneration.js';
import {
  canonicalJson,
  journalFieldsPatchSchema,
  sha256,
  transcriptEvidenceSchema,
} from '../domain/journalLedger.js';
import {
  diffVersions,
  entryDetail,
  evidenceRefs,
  journalSources,
  listEntries,
} from '../domain/journalProjection.js';
import { TurnStatus } from '../domain/options.js';
import type { ProviderSettings } from '../domain/types.js';
import type { Store } from '../store.js';
import { JournalJobStore, type JournalJobRow } from './journalJobs.js';
import { HistoryStore } from './historyStore.js';

/** Lease renewal interval; ownership upkeep only, never an AI deadline. */
const JOURNAL_HEARTBEAT_MS = 15_000;

export type JournalEvidenceDetail =
  | { kind: 'map_asset'; label: string; available: boolean; quote: string }
  | { kind: 'turn'; label: string; turnId: string; available: boolean }
  | { kind: 'campaign_source'; label: string; quote: string; available: true }
  | { kind: 'book'; label: string; quote: string; source: string; available: true };

export type JournalFindingView = {
  outcome: JournalCheckOutcome;
  outcomeLabel: string;
  reason: string;
  knowledgeId: string;
  proposalDigest: string | null;
  changes: { field: string; label: string; before: string | null; after: string | null }[];
  evidence: { turnId: string; field: string; quote: string }[];
};
export type JournalJobView = {
  id: string;
  kind: JournalJobKind;
  status: JournalJobStatus;
  statusLabel: string;
  active: boolean;
  progress: {
    processedPairs: number;
    eligiblePairs: number;
    created: number | null;
    skipped: number | null;
  } | null;
  error: { code: string; message: string } | null;
  finding: JournalFindingView | null;
  decision: JournalDecision | null;
  createdAt: string;
  updatedAt: string;
};

const findingSchema = z
  .object({
    outcome: z.enum(JournalCheckOutcome),
    reason: z.string(),
    knowledgeId: z.uuid(),
    before: journalFieldsPatchSchema,
    changes: journalFieldsPatchSchema.nullable(),
    evidence: z.array(transcriptEvidenceSchema),
    proposalDigest: z.string().nullable(),
  })
  .strict();
const checkStagedSchema = z.object({ finding: findingSchema }).strict();
const checkpointSchema = z
  .object({
    position: z.object({
      turnIndex: z.number().int().nonnegative(),
      fieldIndex: z.number().int().min(0).max(1),
      offset: z.number().int().nonnegative(),
    }),
    processedPairs: z.number().int().nonnegative(),
    eligiblePairs: z.number().int().nonnegative(),
    inputIdentity: z.string(),
    gathered: z
      .array(z.object({ evidence: transcriptEvidenceSchema, relation: z.string() }))
      .optional(),
    created: z.number().int().nonnegative().optional(),
    skipped: z.number().int().nonnegative().optional(),
  })
  .passthrough();
type Checkpoint = z.infer<typeof checkpointSchema>;
const frozenSchema = z.object({
  input: z.custom<FrozenJournalInput>(),
  settings: z.custom<ProviderSettings>(),
});

const cancelled = () => new Problem(409, 'cancelled', 'Journal task is no longer active');

/** Journal reads project canonical knowledge; jobs add whole-history backfill and fact checks. */
export class JournalService {
  private aborts = new Map<string, AbortController>();
  private jobs: JournalJobStore;
  constructor(
    private store: Store,
    private generator?: Generator
  ) {
    this.jobs = new JournalJobStore(store);
  }

  // ---------------------------------------------------------------- reads (no AI)

  async list(campaignId: string, query: JournalListQuery): Promise<JournalPage> {
    const c = await this.store.campaign(campaignId);
    return listEntries(c.knowledge ?? [], c.characters, query, c);
  }

  async entry(campaignId: string, entryId: string): Promise<JournalEntry> {
    const c = await this.store.campaign(campaignId);
    // Existence and visibility first: a hidden record must not reveal itself through history lookups.
    entryDetail(c.knowledge ?? [], c.characters, entryId, c);
    const snapshots = await this.store.knowledgeSnapshots(campaignId, entryId);
    const { entry } = entryDetail(c.knowledge ?? [], c.characters, entryId, c, snapshots);
    // Evidence availability reflects whether the conversation is still part of the active story.
    for (const ref of entry.evidence ?? [])
      if (ref.kind === 'turn') ref.available = await this.turnAvailable(campaignId, ref.turnId!);
    return entry;
  }

  async evidence(
    campaignId: string,
    entryId: string,
    evidenceId: string
  ): Promise<JournalEvidenceDetail> {
    const c = await this.store.campaign(campaignId);
    const { record } = entryDetail(c.knowledge ?? [], c.characters, entryId, c);
    const ref = evidenceRefs(record, c).find((r) => r.id === evidenceId);
    if (!ref) throw new Problem(404, 'journal_not_found', 'Journal evidence not found');
    if (ref.kind === 'turn')
      return {
        kind: 'turn',
        label: ref.label,
        turnId: ref.turnId!,
        available: await this.turnAvailable(campaignId, ref.turnId!),
      };
    const index = Number(evidenceId.replace('evidence-', ''));
    const e = record.evidence[index]!;
    if (e.type === 'map_asset')
      return {
        kind: 'map_asset',
        label: 'Map observation',
        available: false,
        quote:
          'Open the atlas for reviewed image previews and accepted geography. Original image observations are kept private.',
      };
    // Only the recorded quote is exposed, never the whole private source document.
    return e.type === 'campaign_source'
      ? { kind: 'campaign_source', label: ref.label, quote: e.quote, available: true }
      : {
          kind: 'book',
          label: ref.label,
          quote: e.citation.quote,
          source: e.citation.source,
          available: true,
        };
  }

  private async turnAvailable(campaignId: string, turnId: string): Promise<boolean> {
    try {
      const turn = await this.store.turn(campaignId, turnId);
      return turn.status === TurnStatus.Completed && !turn.undone;
    } catch (e) {
      if (e instanceof Problem && e.status === 404) return false;
      throw e;
    }
  }

  // ---------------------------------------------------------------- job lifecycle

  private async requireProvider(settings: ProviderSettings): Promise<Generator> {
    if (!this.generator)
      throw new Problem(503, 'journal_provider_unavailable', 'No AI provider is available');
    try {
      await this.generator.capacity(settings);
    } catch (e) {
      if (e instanceof Problem) throw new Problem(503, 'journal_provider_unavailable', e.message);
      throw e;
    }
    return this.generator;
  }

  /** Start a whole-history backfill or a fact check; exact request replays return the original job. */
  async start(
    campaignId: string,
    kind: JournalJobKind,
    requestId: string,
    params: { entryId?: string; explanation?: string } = {}
  ): Promise<JournalJobView> {
    const identity = sha256(
      canonicalJson({
        kind,
        entryId: params.entryId ?? null,
        explanation: params.explanation ?? null,
      })
    );
    const prior = await this.jobs.find(campaignId, requestId);
    if (prior) return this.replay(prior, identity);
    const initial = await this.store.campaign(campaignId);
    await this.requireProvider(initial.settings);
    let launch = false;
    const job = await this.store
      .transaction(async (client) => {
        const c = await this.store.campaign(campaignId, client, true);
        const again = await this.jobs.find(campaignId, requestId, client);
        if (again) return again;
        await this.store.assertIdle(campaignId, client);
        const turns = await this.store.activeTurns(campaignId, client);
        const input = captureJournalInput(c, turns);
        if (!input.turns.length)
          throw new Problem(
            422,
            'journal_invalid',
            'There are no completed conversations to use yet'
          );
        if (kind === JournalJobKind.Check)
          input.target = captureTarget(c, params.entryId!, params.explanation!);
        const id = randomUUID();
        await this.jobs.insertRunning(client, {
          id,
          campaignId,
          requestId,
          kind,
          identityDigest: identity,
          frozenInput: { input, settings: c.settings },
          checkpoint: {
            position: START_POSITION,
            processedPairs: 0,
            eligiblePairs: input.turns.length,
            inputIdentity: inputIdentity(input),
          },
        });
        launch = true;
        return this.jobs.get(campaignId, id, client);
      })
      .catch((e) => {
        if ((e as { code?: string } | null)?.code === '23505')
          throw new Problem(409, 'journal_busy', 'Another Journal task is already running');
        throw e;
      });
    if (!launch) return this.replay(job, identity);
    queueMicrotask(() => {
      void this.run(job).catch((error) => reportProcessingFailure('journal_background', error));
    });
    return this.view(job, initial);
  }

  private async replay(job: JournalJobRow, identity: string): Promise<JournalJobView> {
    if (job.identityDigest !== identity)
      throw new Problem(
        409,
        'journal_request_reused',
        'Request ID was already used with different input; generate a new ID'
      );
    return this.status(job.campaignId, job.id);
  }

  async status(campaignId: string, jobId: string): Promise<JournalJobView> {
    const job = await this.jobs.get(campaignId, jobId);
    return this.view(job, await this.store.campaign(campaignId));
  }

  private async view(
    job: JournalJobRow,
    c: { characters: { id: string; name: string }[] }
  ): Promise<JournalJobView> {
    const decision = await this.jobs.anyDecision(job.id);
    const checkpoint = checkpointSchema.safeParse(job.checkpoint);
    const cp = checkpoint.success ? checkpoint.data : null;
    let finding: JournalFindingView | null = null;
    if (job.kind === JournalJobKind.Check && job.stagedResult) {
      const parsed = checkStagedSchema.safeParse(job.stagedResult);
      if (parsed.success) finding = this.findingView(parsed.data.finding, c.characters);
    }
    const staged =
      job.kind === JournalJobKind.Backfill && job.stagedResult
        ? stagedBackfillSchema.safeParse(job.stagedResult)
        : null;
    return {
      id: job.id,
      kind: job.kind,
      status: job.status,
      statusLabel: JOURNAL_JOB_STATUS_OPTIONS.find((o) => o.id === job.status)?.label ?? job.status,
      active: this.jobs.active(job.status),
      progress: cp
        ? {
            processedPairs: cp.processedPairs,
            eligiblePairs: cp.eligiblePairs,
            created: staged?.success ? staged.data.entries.length : (cp.created ?? null),
            skipped: staged?.success ? staged.data.skipped : (cp.skipped ?? null),
          }
        : null,
      error: job.safeError
        ? { code: job.errorCode ?? 'journal_failed', message: job.safeError }
        : null,
      finding,
      decision: decision?.decision ?? null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }

  private findingView(
    f: z.infer<typeof findingSchema>,
    characters: { id: string; name: string }[]
  ): JournalFindingView {
    const keys = f.changes ? Object.keys(f.changes) : [];
    return {
      outcome: f.outcome,
      outcomeLabel:
        JOURNAL_CHECK_OUTCOME_OPTIONS.find((o) => o.id === f.outcome)?.label ?? f.outcome,
      reason: f.reason,
      knowledgeId: f.knowledgeId,
      proposalDigest: f.proposalDigest,
      changes: f.changes
        ? diffVersions(
            f.before as Record<string, unknown>,
            f.changes as Record<string, unknown>,
            characters,
            keys
          )
        : [],
      evidence: f.evidence.map((e) => ({ turnId: e.turnId, field: e.field, quote: e.quote })),
    };
  }

  async cancel(campaignId: string, jobId: string): Promise<JournalJobView> {
    await this.store.transaction(async (client) => {
      await this.store.campaign(campaignId, client, true);
      const job = await this.jobs.get(campaignId, jobId, client, true);
      if (this.jobs.active(job.status)) await this.jobs.cancel(client, jobId);
    });
    this.aborts.get(jobId)?.abort();
    return this.status(campaignId, jobId);
  }

  /** Explicit rerun of an interrupted or failed uncommitted job with its original capture. */
  async retry(campaignId: string, jobId: string): Promise<JournalJobView> {
    const initial = await this.jobs.get(campaignId, jobId);
    const frozen = frozenSchema.parse(initial.frozenInput);
    await this.requireProvider(frozen.settings);
    let launch: JournalJobRow | null = null;
    await this.store.transaction(async (client) => {
      const c = await this.store.campaign(campaignId, client, true);
      const job = await this.jobs.get(campaignId, jobId, client, true);
      if (this.jobs.active(job.status) || job.status === JournalJobStatus.Completed) return;
      if (job.status === JournalJobStatus.Cancelled)
        throw new Problem(
          409,
          'journal_changed',
          'A cancelled task cannot be resumed; start a new one'
        );
      await this.store.assertIdle(campaignId, client);
      const turns = await this.store.activeTurns(campaignId, client);
      const live = captureJournalInput(c, turns);
      if (frozen.input.target) live.target = frozen.input.target;
      const cp = checkpointSchema.parse(job.checkpoint);
      // Facts or history changed since capture: the saved work no longer describes this campaign.
      if (inputIdentity(live) !== cp.inputIdentity) throw journalChanged();
      await this.jobs.resume(client, jobId);
      launch = await this.jobs.get(campaignId, jobId, client);
    });
    if (launch) {
      const row: JournalJobRow = launch;
      queueMicrotask(() => {
        void this.run(row).catch((error) => reportProcessingFailure('journal_background', error));
      });
    }
    return this.status(campaignId, jobId);
  }

  // ---------------------------------------------------------------- runner

  private async run(job: JournalJobRow): Promise<void> {
    const ctl = new AbortController();
    this.aborts.set(job.id, ctl);
    const beat = setInterval(() => {
      void this.jobs
        .renew(job.id)
        .then((ok) => {
          if (!ok) ctl.abort();
        })
        .catch(() => undefined);
    }, JOURNAL_HEARTBEAT_MS);
    try {
      const { input, settings } = frozenSchema.parse(job.frozenInput);
      const generator = await this.requireProvider(settings);
      if (job.kind === JournalJobKind.Backfill)
        await this.runBackfill(job, input, settings, generator, ctl.signal);
      else await this.runCheck(job, input, settings, generator, ctl.signal);
    } catch (error) {
      if (ctl.signal.aborted || (error instanceof Problem && error.code === 'cancelled')) return;
      reportProcessingFailure('journal_job', error);
      const problem =
        error instanceof z.ZodError
          ? new Problem(
              502,
              'journal_invalid_response',
              'The CLI returned an unusable Journal answer; retry the task.'
            )
          : operationalProblem(error);
      await this.jobs
        .finish(job.id, JournalJobStatus.Failed, {
          safeError: problem.message,
          errorCode: problem.code,
        })
        .catch((e) => reportProcessingFailure('journal_job_finish', e));
    } finally {
      clearInterval(beat);
      this.aborts.delete(job.id);
    }
  }

  private async alive(job: JournalJobRow, signal: AbortSignal): Promise<void> {
    if (signal.aborted || !(await this.jobs.owned(job.id))) throw cancelled();
  }

  private async trace(job: JournalJobRow, purpose: string): Promise<PromptTraceContext> {
    const root: PromptTraceContext = {
      runId: job.id,
      executionId: randomUUID(),
      campaignId: job.campaignId,
      purpose,
    };
    root.trace = await createPromptTrace(purpose, root);
    return root;
  }

  private async generate(
    generator: Generator,
    settings: ProviderSettings,
    prompt: string,
    schema: unknown,
    signal: AbortSignal,
    root: PromptTraceContext
  ): Promise<unknown> {
    const child: PromptTraceContext = { ...root, executionId: randomUUID() };
    await traceEvent(child, 'request', { prompt, schema }, true);
    try {
      const result = await generator.generate(settings, prompt, schema, signal, child);
      await traceEvent(child, 'result', { result });
      return result;
    } catch (error) {
      await traceEvent(child, 'failure', safeTraceFailure(error));
      throw error;
    }
  }

  private async runBackfill(
    job: JournalJobRow,
    input: FrozenJournalInput,
    settings: ProviderSettings,
    generator: Generator,
    signal: AbortSignal
  ): Promise<void> {
    const trace = await this.trace(job, 'journal_backfill');
    let cp = checkpointSchema.parse(job.checkpoint);
    let staged: StagedBackfill = job.stagedResult
      ? stagedBackfillSchema.parse(job.stagedResult)
      : emptyStaged();
    let position: BatchPosition = cp.position;
    // The CLI owns real capacity; this is only a soft target for sequential batching.
    const capacity = await generator.capacity(settings);
    while (position.turnIndex < input.turns.length) {
      await this.alive(job, signal);
      const { segments, next } = nextBatch(
        input.turns,
        position,
        (candidate) =>
          Buffer.byteLength(backfillPrompt(input, staged, candidate), 'utf8') <= capacity
      );
      if (segments.length) {
        const out = await this.generate(
          generator,
          settings,
          backfillPrompt(input, staged, segments),
          backfillOutputJsonSchema,
          signal,
          trace
        );
        staged = reduceBackfill(staged, out, input, segments);
      }
      position = next;
      cp = { ...cp, position, processedPairs: position.turnIndex };
      if (!(await this.jobs.renew(job.id, { checkpoint: cp, staged }))) throw cancelled();
    }
    await this.alive(job, signal);
    await this.commitBackfill(job, input, staged, cp);
  }

  private async commitBackfill(
    job: JournalJobRow,
    input: FrozenJournalInput,
    staged: StagedBackfill,
    cp: Checkpoint
  ): Promise<void> {
    await this.store.transaction(async (client) => {
      const c = await this.store.campaign(job.campaignId, client, true);
      await this.store.assertIdle(job.campaignId, client, job.id);
      const turns = await this.store.activeTurns(job.campaignId, client);
      const live = captureJournalInput(c, turns);
      // Only a change to captured facts or history rejects; notes and revisions do not.
      if (inputIdentity(live) !== cp.inputIdentity) throw journalChanged();
      const next = applyBackfill(
        c,
        staged,
        new Map(turns.map((t) => [t.id, t])),
        input.turns.map((t) => t.id),
        job.id
      );
      await this.store.save(next, client);
      const finished = await this.jobs.finish(
        job.id,
        JournalJobStatus.Completed,
        {
          staged,
          checkpoint: {
            ...cp,
            processedPairs: input.turns.length,
            created: staged.entries.length,
            skipped: staged.skipped,
          },
        },
        client
      );
      if (!finished) throw cancelled();
    });
  }

  private async runCheck(
    job: JournalJobRow,
    input: FrozenJournalInput,
    settings: ProviderSettings,
    generator: Generator,
    signal: AbortSignal
  ): Promise<void> {
    const trace = await this.trace(job, 'journal_check');
    let cp = checkpointSchema.parse(job.checkpoint);
    let gathered = (cp.gathered ?? []) as GatheredEvidence[];
    let position: BatchPosition = cp.position;
    const capacity = await generator.capacity(settings);
    while (position.turnIndex < input.turns.length) {
      await this.alive(job, signal);
      const { segments, next } = nextBatch(
        input.turns,
        position,
        (candidate) =>
          Buffer.byteLength(gatherPrompt(input, gathered, candidate), 'utf8') <= capacity
      );
      if (segments.length) {
        const out = await this.generate(
          generator,
          settings,
          gatherPrompt(input, gathered, segments),
          gatherOutputJsonSchema,
          signal,
          trace
        );
        gathered = reduceGather(gathered, out, input, segments);
      }
      position = next;
      cp = { ...cp, position, processedPairs: position.turnIndex, gathered };
      if (!(await this.jobs.renew(job.id, { checkpoint: cp }))) throw cancelled();
    }
    await this.alive(job, signal);
    const target = input.target!;
    let finding: CheckFinding;
    if (!gathered.length)
      // Nothing to weigh: no model call, and never a fabricated correction.
      finding = {
        outcome: JournalCheckOutcome.Inconclusive,
        reason: 'No saved conversation evidence about this record was found.',
        knowledgeId: target.id,
        before: {},
        changes: null,
        evidence: [],
        proposalDigest: null,
      };
    else {
      const out = await this.generate(
        generator,
        settings,
        decisionPrompt(input, gathered),
        decisionOutputJsonSchema,
        signal,
        trace
      );
      finding = reduceDecision(out, input, gathered);
    }
    const finished = await this.jobs.finish(job.id, JournalJobStatus.Completed, {
      staged: { finding },
      checkpoint: { ...cp, processedPairs: input.turns.length },
    });
    if (!finished) throw cancelled();
  }

  // ---------------------------------------------------------------- decisions

  async accept(
    campaignId: string,
    jobId: string,
    requestId: string,
    proposalDigest: string
  ): Promise<{ decision: JournalDecision; entry: JournalEntry }> {
    const identity = sha256(canonicalJson({ decision: JournalDecision.Accepted, proposalDigest }));
    const saved = await this.savedDecision(jobId, requestId, identity);
    if (saved) return saved;
    return this.store.transaction(async (client) => {
      const c = await this.store.campaign(campaignId, client, true);
      const job = await this.jobs.get(campaignId, jobId, client, true);
      const again = await this.savedDecision(jobId, requestId, identity, client);
      if (again) return again;
      const finding = this.proposed(job);
      if (finding.proposalDigest !== proposalDigest)
        throw new Problem(
          409,
          'journal_proposal_changed',
          'The proposal changed; review the new finding'
        );
      await this.store.assertIdle(campaignId, client);
      const frozen = frozenSchema.parse(job.frozenInput);
      const record = journalSources(c.knowledge ?? []).find((r) => r.id === finding.knowledgeId);
      // Unrelated notes or campaign revisions do not reject; a changed target or evidence does.
      if (!record || targetDigest(record) !== frozen.input.target!.digest)
        throw new Problem(
          409,
          'journal_proposal_changed',
          'The recorded fact changed after this check; run the check again'
        );
      const turns = await this.store.activeTurns(campaignId, client);
      const proposal = correctionProposalSchema.parse({
        knowledgeId: finding.knowledgeId,
        changes: finding.changes,
        reason: finding.reason,
        evidence: finding.evidence,
      });
      const { campaign: next } = applyCorrection(
        c,
        proposal,
        new Map(turns.map((t) => [t.id, t])),
        jobId
      );
      // Existing summaries may carry the superseded fact; retire all of them, regenerate on demand.
      await client.query(
        "UPDATE memories SET document=jsonb_set(document,'{valid}','false'::jsonb) WHERE campaign_id=$1",
        [campaignId]
      );
      next.memory = null;
      // History summaries may carry the superseded fact too; they wait for a refresh.
      await new HistoryStore(this.store).invalidateAll(client, campaignId);
      await this.store.save(next, client);
      const { entry } = entryDetail(
        next.knowledge ?? [],
        next.characters,
        finding.knowledgeId,
        next
      );
      const result = { decision: JournalDecision.Accepted, entry };
      await this.jobs.recordDecision(client, {
        jobId,
        requestId,
        decision: JournalDecision.Accepted,
        identityDigest: identity,
        result,
      });
      return result;
    });
  }

  async dismiss(
    campaignId: string,
    jobId: string,
    requestId: string
  ): Promise<{ decision: JournalDecision }> {
    const identity = sha256(canonicalJson({ decision: JournalDecision.Dismissed }));
    const saved = await this.savedDecision(jobId, requestId, identity);
    if (saved) return { decision: saved.decision };
    return this.store.transaction(async (client) => {
      await this.store.campaign(campaignId, client, true);
      const job = await this.jobs.get(campaignId, jobId, client, true);
      const again = await this.savedDecision(jobId, requestId, identity, client);
      if (again) return { decision: again.decision };
      if (job.kind !== JournalJobKind.Check || job.status !== JournalJobStatus.Completed)
        throw new Problem(
          409,
          'journal_proposal_changed',
          'There is no finished finding to dismiss'
        );
      await this.jobs.recordDecision(client, {
        jobId,
        requestId,
        decision: JournalDecision.Dismissed,
        identityDigest: identity,
        result: null,
      });
      return { decision: JournalDecision.Dismissed };
    });
  }

  private proposed(job: JournalJobRow): z.infer<typeof findingSchema> {
    if (job.kind !== JournalJobKind.Check || job.status !== JournalJobStatus.Completed)
      throw new Problem(409, 'journal_proposal_changed', 'There is no finished finding to accept');
    const finding = checkStagedSchema.parse(job.stagedResult).finding;
    if (finding.outcome !== JournalCheckOutcome.Proposed || !finding.changes)
      throw new Problem(422, 'journal_invalid', 'This finding has no correction to accept');
    return finding;
  }

  /** Replay of a decision: same request returns the saved result; any other terminal decision is final. */
  private async savedDecision(
    jobId: string,
    requestId: string,
    identity: string,
    client?: PoolClient
  ): Promise<{ decision: JournalDecision; entry: JournalEntry } | null> {
    const own = await this.jobs.decision(jobId, requestId, client);
    if (own) {
      if (own.identityDigest !== identity)
        throw new Problem(
          409,
          'journal_request_reused',
          'Request ID was already used with different input; generate a new ID'
        );
      return { decision: own.decision, entry: (own.result?.entry ?? null) as JournalEntry };
    }
    const other = await this.jobs.anyDecision(jobId, client);
    if (other)
      throw new Problem(409, 'journal_request_reused', 'This finding already has a final decision');
    return null;
  }
}
