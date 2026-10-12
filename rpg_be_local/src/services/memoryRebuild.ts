import { randomUUID } from 'node:crypto';
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
import { RESPONSE_RETRY_COUNT, structuredResponseRetryFeedback } from '../domain/responseRetry.js';
import { composeMemory } from '../domain/memory.js';
import {
  MEMORY_REBUILD_HEARTBEAT_MS,
  MemoryRebuildAction,
  MemoryRebuildError,
  MemoryRebuildPurpose,
  MemoryRebuildStatus,
  isActiveStatus,
  statusOption,
  type MemoryRebuildJobView,
  type MemoryRebuildPage,
  type MemoryRebuildReceiptAction,
} from '../domain/memoryRebuild.js';
import {
  captureRebuildInput,
  nextRebuildBatch,
  proposalDigest,
  rebuildPrompt,
  sourceIdentity,
  targetIdentity,
  compactTargetIdentity,
  boundedBackground,
  type FrozenRebuildInput,
} from '../domain/memoryRebuildGeneration.js';
import { canonicalJson, sha256 } from '../domain/journalLedger.js';
import { correctionDigestOf } from '../domain/historyRecall.js';
import {
  HistoryStepKind,
  chapterPrompt,
  derivationDigest,
  historySectionJsonSchema,
  historySectionSchema,
  historyOverviewJsonSchema,
  historyOverviewSchema,
  overviewPrompt,
  planHistory,
  sectionPrompt,
  stagedRef,
  type StagedFragment,
} from '../domain/historyGeneration.js';
import {
  HistoryFragmentKind,
  HistorySelectionStatus,
  historySettingsOf,
  type SourceLocator,
} from '../domain/historyRecall.js';
import { RECENT_GAMEPLAY_TURN_COUNT } from '../domain/context.js';
import { HistoryStore } from './historyStore.js';
import { publicCampaign } from '../domain/playerProjection.js';
import { memoryJsonSchema, memorySchema } from '../domain/schemas.js';
import type { Campaign, Memory } from '../domain/types.js';
import type { Store } from '../store.js';
import { MemoryRebuildJobStore, type MemoryRebuildJobRow } from './memoryRebuildJobs.js';
import {
  GmIndexPreparationMode,
  captureGmIndexGeneration,
  gmIndexGenerationSourceIdentity,
  gmIndexGenerationTargetIdentity,
  gmIndexPreview,
  gmIndexScanBatches,
  gmIndexScanPrompt,
  gmIndexScanSchema,
  gmIndexPreparationSchema,
  gmIndexPreparedDocument,
  normalizeGmIndexPreparationOutput,
  normalizeGmIndexGenerationRefs,
  gmIndexPreparationDigest,
  GM_INDEX_PREPARATION_INSTRUCTIONS,
  type GmIndexGenerationCapture,
} from '../domain/gmIndexGeneration.js';
import { requireGmIndexTransport } from './gmIndexUpdater.js';
import {
  createGmIndexReadTools,
  restoreGmIndexSourceReads,
  gmIndexReadSummary,
  type GmIndexReadReceipt,
} from './gmIndexReadTools.js';
import { HISTORY_DEFAULTS } from '../domain/historyRecall.js';
import { turnVersionOf } from '../domain/historyRecall.js';
import { correctionGuidance } from '../domain/journalCompatibility.js';

const cancelled = () => new Problem(409, 'cancelled', 'Memory rebuild is no longer active');
const identityOf = (action: MemoryRebuildAction, extra: Record<string, unknown> = {}) =>
  sha256(canonicalJson({ action, ...extra }));

export type MemoryRebuildApplyResult = { campaign: Campaign; job: MemoryRebuildJobView };

/** Rebuilds campaign memory from the original transcript into a reviewable draft; Apply is explicit. */
export class MemoryRebuildService {
  private aborts = new Map<string, AbortController>();
  private jobs: MemoryRebuildJobStore;
  constructor(
    private store: Store,
    private generator?: Generator
  ) {
    this.jobs = new MemoryRebuildJobStore(store);
  }

  // ---------------------------------------------------------------- views

  async status(campaignId: string, jobId: string): Promise<MemoryRebuildJobView> {
    return this.view(await this.jobs.get(campaignId, jobId));
  }

  async list(campaignId: string, limit: number, offset: number): Promise<MemoryRebuildPage> {
    await this.store.campaign(campaignId);
    const rows = await this.jobs.list(campaignId, limit + 1, offset);
    const attention = await this.jobs.attention(campaignId);
    const attentionByPurpose = await this.jobs.attentionByPurpose(campaignId);
    return {
      jobs: rows.slice(0, limit).map((row) => this.view(row)),
      current: attention ? this.view(attention) : null,
      attentionByPurpose: attentionByPurpose.map((row) => this.view(row)),
      nextCursor: rows.length > limit ? String(offset + limit) : null,
    };
  }

  private view(job: MemoryRebuildJobRow): MemoryRebuildJobView {
    const option = statusOption(job.status);
    const showCandidate =
      (job.status === MemoryRebuildStatus.Ready || job.status === MemoryRebuildStatus.Applied) &&
      job.candidateText !== null &&
      job.proposalDigest !== null;
    return {
      id: job.id,
      ...(job.purpose === MemoryRebuildPurpose.GmIndex
        ? {
            gmIndex: {
              mode: (job.frozenInput as unknown as GmIndexGenerationCapture).mode,
              preview: showCandidate ? (job.gmIndexProposal?.preview ?? null) : null,
              progress: this.indexProgress(job),
            },
          }
        : {}),
      campaignId: job.campaignId,
      purpose: job.purpose,
      status: job.status,
      statusLabel: option.label,
      active: option.active,
      processedTurns: job.checkpoint.processedTurns,
      totalTurns: job.checkpoint.totalTurns,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      errorCode: job.errorCode,
      safeError: job.safeError,
      allowedActions: [...option.actions],
      baseline: job.purpose === MemoryRebuildPurpose.GmIndex ? null : job.baseline,
      candidate: showCandidate
        ? {
            text: job.purpose === MemoryRebuildPurpose.GmIndex ? '' : job.candidateText!,
            coveredTurnIds: job.candidateCoveredTurnIds ?? [],
            proposalDigest: job.proposalDigest!,
          }
        : null,
      compact:
        job.purpose === MemoryRebuildPurpose.CompactHistory && job.staged
          ? {
              sections: job.staged.filter(
                (f) => (f as StagedFragment).kind === HistoryFragmentKind.Section
              ).length,
              chapters: job.staged.filter(
                (f) => (f as StagedFragment).kind === HistoryFragmentKind.Chapter
              ).length,
            }
          : null,
      decision: job.decision
        ? {
            action: job.decision,
            requestId: job.decisionRequestId!,
            memoryId: job.decisionMemoryId,
          }
        : null,
    };
  }

  private indexProgress(job: MemoryRebuildJobRow) {
    const batches = gmIndexScanBatches(job.frozenInput as unknown as GmIndexGenerationCapture);
    const step = job.checkpoint.nextIndex;
    const batch = batches[step] as { kind?: string } | undefined;
    const label =
      job.status === MemoryRebuildStatus.Ready || job.status === MemoryRebuildStatus.Applied
        ? 'Ready for review'
        : batch?.kind === 'canonical'
          ? 'Reading current campaign facts'
          : batch?.kind === 'source_original'
            ? 'Reading campaign source sections'
            : batch?.kind === 'original_turns'
              ? 'Reading saved original turns'
              : step === batches.length
                ? 'Merging the working index'
                : 'Preparing compact history';
    const reads = (job.indexReadInvocations ?? []).flat();
    return {
      label,
      completedSteps: step,
      totalSteps: job.checkpoint.totalTurns,
      retrievalCalls: reads.length,
      emptySearches: reads.filter((read) => gmIndexReadSummary(read).empty).length,
      lastActivityAt: job.updatedAt,
    };
  }

  // ---------------------------------------------------------------- lifecycle

  private async requireProvider(settings: Campaign['settings']): Promise<Generator> {
    if (!this.generator)
      throw new Problem(503, 'memory_provider_unavailable', 'No AI provider is available');
    try {
      await this.generator.capacity(settings);
    } catch (e) {
      if (e instanceof Problem) throw new Problem(503, 'memory_provider_unavailable', e.message);
      throw e;
    }
    return this.generator;
  }

  private launch(job: MemoryRebuildJobRow, owner: string): void {
    queueMicrotask(() => {
      void this.run(job, owner).catch((error) =>
        reportProcessingFailure('memory_rebuild_background', error)
      );
    });
  }

  /** Idempotent start: a repeated request ID returns the original job without repeating work. */
  async start(
    campaignId: string,
    requestId: string,
    purpose: MemoryRebuildPurpose = MemoryRebuildPurpose.Memory,
    mode: GmIndexPreparationMode = GmIndexPreparationMode.Prepare
  ): Promise<MemoryRebuildJobView> {
    // The original identity is kept for full-memory rebuilds so earlier requests still replay.
    const identity = sha256(
      canonicalJson(
        purpose === MemoryRebuildPurpose.Memory
          ? { operation: 'start' }
          : {
              operation: 'start',
              purpose,
              ...(purpose === MemoryRebuildPurpose.GmIndex ? { mode } : {}),
            }
      )
    );
    const prior = await this.jobs.find(campaignId, requestId);
    if (prior) return this.replay(prior, identity);
    const initial = await this.store.campaign(campaignId);
    await this.requireProvider(initial.settings);
    const gm = purpose === MemoryRebuildPurpose.GmIndex;
    if (gm) await requireGmIndexTransport(this.generator!, initial.settings);
    let launch: { job: MemoryRebuildJobRow; owner: string } | null = null;
    const job = await this.store
      .transaction(async (client) => {
        const c = await this.store.campaign(campaignId, client, true);
        const again = await this.jobs.find(campaignId, requestId, client);
        if (again) return again;
        await this.store.assertIdle(campaignId, client);
        const turns = await this.store.activeTurns(campaignId, client);
        if (!turns.length && !gm)
          throw new Problem(
            422,
            MemoryRebuildError.Invalid,
            'There are no completed turns to rebuild memory from yet'
          );
        const input = captureRebuildInput(c, turns);
        const compact = purpose === MemoryRebuildPurpose.CompactHistory || gm;
        const steps = compact ? planHistory(input.turns, RECENT_GAMEPLAY_TURN_COUNT) : [];
        if (compact && !steps.length && !gm)
          throw new Problem(
            422,
            MemoryRebuildError.Invalid,
            'There is not enough older completed history to consolidate yet'
          );
        // Source versions are captured with the freeze, before any provider work.
        const versions = compact
          ? await new HistoryStore(this.store).captureVersions(client, campaignId, turns)
          : [];
        const id = randomUUID();
        const owner = randomUUID();
        if (gm && canonicalJson(c.settings) !== canonicalJson(initial.settings))
          throw new Problem(
            409,
            MemoryRebuildError.Stale,
            'Provider settings changed during index preflight.'
          );
        const gmCapture = gm
          ? captureGmIndexGeneration(
              c,
              turns,
              mode,
              versions.map(({ turnId, contentHash }) => ({ turnId, contentHash }))
            )
          : null;
        await this.jobs.insertRunning(client, {
          id,
          campaignId,
          requestId,
          identityDigest: identity,
          owner,
          purpose,
          frozenInput:
            gmCapture ??
            (compact
              ? {
                  ...input,
                  purpose,
                  versions: versions.map(({ turnId, contentHash }) => ({ turnId, contentHash })),
                  protectedKnowledgeIds: historySettingsOf(c).protectedKnowledgeIds,
                }
              : input),
          sourceIdentity: gm ? gmIndexGenerationSourceIdentity(c, turns) : sourceIdentity(input),
          targetIdentity: gm
            ? gmIndexGenerationTargetIdentity(c)
            : compact
              ? compactTargetIdentity(c)
              : targetIdentity(c.memory),
          baseline: c.memory?.valid ? c.memory : null,
          checkpoint: {
            nextIndex: 0,
            processedTurns: 0,
            totalTurns: gmCapture
              ? gmIndexScanBatches(gmCapture).length + 1 + steps.length
              : compact
                ? steps.length
                : input.turns.length,
          },
        });
        const row = await this.jobs.get(campaignId, id, client);
        launch = { job: row, owner };
        return row;
      })
      .catch((e) => {
        if ((e as { code?: string } | null)?.code === '23505')
          throw new Problem(
            409,
            MemoryRebuildError.Busy,
            'Another memory rebuild is already running'
          );
        throw e;
      });
    if (launch) {
      const started: { job: MemoryRebuildJobRow; owner: string } = launch;
      this.launch(started.job, started.owner);
    }
    return this.view(job);
  }

  private replay(job: MemoryRebuildJobRow, identity: string): MemoryRebuildJobView {
    if (job.identityDigest !== identity)
      throw new Problem(
        409,
        MemoryRebuildError.RequestReused,
        'Request ID was already used with different input; generate a new ID'
      );
    return this.view(job);
  }

  async cancel(campaignId: string, jobId: string): Promise<MemoryRebuildJobView> {
    await this.store.transaction(async (client) => {
      await this.store.campaign(campaignId, client, true);
      const job = await this.jobs.get(campaignId, jobId, client, true);
      if (isActiveStatus(job.status)) await this.jobs.cancel(client, jobId);
    });
    for (const [key, controller] of this.aborts)
      if (key.startsWith(`${jobId}:`)) controller.abort();
    return this.status(campaignId, jobId);
  }

  /** Begin a fresh attempt for a failed/interrupted job; committed batches are never repeated. */
  async resume(
    campaignId: string,
    jobId: string,
    requestId: string
  ): Promise<MemoryRebuildJobView> {
    const identity = identityOf(MemoryRebuildAction.Resume);
    const saved = await this.jobs.receipt(jobId, MemoryRebuildAction.Resume, requestId);
    if (saved) return this.replayReceipt(campaignId, jobId, saved.identityDigest, identity);
    const capturedJob = await this.jobs.get(campaignId, jobId);
    const settings =
      capturedJob.purpose === MemoryRebuildPurpose.GmIndex
        ? (capturedJob.frozenInput as unknown as GmIndexGenerationCapture).campaign.settings
        : frozenSchema.parse(capturedJob.frozenInput).settings;
    await this.requireProvider(settings);
    if (capturedJob.purpose === MemoryRebuildPurpose.GmIndex)
      await requireGmIndexTransport(this.generator!, settings);
    let launch: { job: MemoryRebuildJobRow; owner: string } | null = null;
    await this.store.transaction(async (client) => {
      const c = await this.store.campaign(campaignId, client, true);
      const job = await this.jobs.get(campaignId, jobId, client, true);
      const again = await this.jobs.receipt(jobId, MemoryRebuildAction.Resume, requestId, client);
      if (again) return;
      if (isActiveStatus(job.status)) return;
      if (
        job.status !== MemoryRebuildStatus.Failed &&
        job.status !== MemoryRebuildStatus.Interrupted
      )
        throw new Problem(
          409,
          MemoryRebuildError.Invalid,
          job.status === MemoryRebuildStatus.Cancelled
            ? 'A cancelled rebuild cannot be resumed; start a new one'
            : 'This rebuild is already finished'
        );
      await this.store.assertIdle(campaignId, client);
      const turns = await this.store.activeTurns(campaignId, client);
      if (
        (job.purpose === MemoryRebuildPurpose.GmIndex
          ? gmIndexGenerationSourceIdentity(c, turns)
          : sourceIdentity(captureRebuildInput(c, turns))) !== job.sourceIdentity
      )
        throw new Problem(
          409,
          MemoryRebuildError.Stale,
          'The story changed after this rebuild started; start a new rebuild'
        );
      const owner = randomUUID();
      await this.jobs.resume(client, jobId, owner);
      await this.jobs.insertReceipt(client, {
        jobId,
        action: MemoryRebuildAction.Resume,
        requestId,
        identityDigest: identity,
        attemptOwner: owner,
        result: null,
      });
      launch = { job: await this.jobs.get(campaignId, jobId, client), owner };
    });
    if (launch) {
      const attempt: { job: MemoryRebuildJobRow; owner: string } = launch;
      this.launch(attempt.job, attempt.owner);
    }
    return this.status(campaignId, jobId);
  }

  private async replayReceipt(
    campaignId: string,
    jobId: string,
    stored: string,
    identity: string
  ): Promise<MemoryRebuildJobView> {
    if (stored !== identity)
      throw new Problem(
        409,
        MemoryRebuildError.RequestReused,
        'Request ID was already used with different input; generate a new ID'
      );
    return this.status(campaignId, jobId);
  }

  // ---------------------------------------------------------------- runner

  private async alive(job: MemoryRebuildJobRow, owner: string, signal: AbortSignal) {
    if (signal.aborted || !(await this.jobs.owned(job.id, owner))) throw cancelled();
  }

  private async generate(
    generator: Generator,
    settings: Campaign['settings'],
    prompt: string,
    signal: AbortSignal,
    root: PromptTraceContext,
    schema: unknown = memoryJsonSchema
  ): Promise<unknown> {
    let feedback = '';
    for (let attempt = 0; ; attempt++) {
      if (signal.aborted) throw cancelled();
      const child: PromptTraceContext = {
        ...root,
        executionId: randomUUID(),
        correctionAttempt: attempt,
      };
      const requestPrompt = feedback
        ? JSON.stringify({ ...JSON.parse(prompt), validationFeedback: feedback })
        : prompt;
      await traceEvent(child, 'request', { prompt: requestPrompt, schema }, true);
      try {
        const result = await generator.generate(settings, requestPrompt, schema, signal, child);
        const validator =
          schema === historySectionJsonSchema
            ? historySectionSchema
            : schema === historyOverviewJsonSchema
              ? historyOverviewSchema
              : memorySchema;
        validator.parse(result);
        await traceEvent(child, 'result', { result });
        return result;
      } catch (error) {
        await traceEvent(child, 'failure', safeTraceFailure(error));
        const reason = structuredResponseRetryFeedback(error);
        if (signal.aborted || reason === null || attempt >= RESPONSE_RETRY_COUNT) throw error;
        feedback = `Previous output failed validation: ${reason}. Return complete strict JSON matching the supplied schema, with no trailing commas or extra prose. Correct only this step; do not repeat prior completed work.`;
        await traceEvent(child, 'response_validation_retry', {
          nextAttempt: attempt + 1,
          ...safeTraceFailure(error),
        });
      }
    }
  }

  private async run(job: MemoryRebuildJobRow, owner: string): Promise<void> {
    const key = `${job.id}:${owner}`;
    const ctl = new AbortController();
    this.aborts.set(key, ctl);
    const beat = setInterval(() => {
      void this.jobs
        .renew(job.id, owner)
        .then((ok) => {
          if (!ok) ctl.abort();
        })
        .catch((error) => {
          // A heartbeat that cannot reach the database means the lease cannot be kept.
          reportProcessingFailure('memory_rebuild_heartbeat', error);
          ctl.abort();
        });
    }, MEMORY_REBUILD_HEARTBEAT_MS);
    let runTrace: PromptTraceContext | undefined;
    try {
      const gmCapture =
        job.purpose === MemoryRebuildPurpose.GmIndex
          ? (job.frozenInput as unknown as GmIndexGenerationCapture)
          : null;
      const frozen = gmCapture
        ? captureRebuildInput(gmCapture.campaign, gmCapture.turns)
        : frozenSchema.parse(job.frozenInput);
      const { settings } = frozen;
      const generator = await this.requireProvider(settings);
      const root: PromptTraceContext = {
        runId: job.id,
        executionId: randomUUID(),
        campaignId: job.campaignId,
        purpose: 'memory_rebuild',
      };
      root.trace = await createPromptTrace('memory_rebuild', root);
      runTrace = root;
      await traceEvent(root, 'rebuild_started', {
        purpose: job.purpose,
        completedSteps: job.checkpoint.nextIndex,
        totalSteps: job.checkpoint.totalTurns,
      });
      if (gmCapture) {
        await this.runGmIndex(job, owner, gmCapture, generator, ctl.signal, root);
        return;
      }
      if (job.purpose === MemoryRebuildPurpose.CompactHistory) {
        await this.runCompact(job, owner, frozen, generator, ctl.signal, root);
        return;
      }
      let cp = job.checkpoint;
      let draft = job.candidateText ?? '';
      let covered = job.candidateCoveredTurnIds ?? [];
      const capacity = await generator.capacity(settings, frozen.compactionBudget);
      const ceiling = Math.min(frozen.compactionBudget, capacity);
      while (cp.nextIndex < frozen.turns.length) {
        await this.alive(job, owner, ctl.signal);
        const background = boundedBackground(draft);
        const batch = nextRebuildBatch(frozen, background, cp.nextIndex, ceiling);
        const parsed = memorySchema.parse(
          await this.generate(
            generator,
            settings,
            rebuildPrompt(frozen, background, batch),
            ctl.signal,
            root
          )
        );
        const prior = draft ? { text: draft, coveredTurnIds: covered, valid: true } : null;
        const composed = composeMemory(
          prior,
          parsed.text,
          batch.map((t) => t.id)
        );
        const next = {
          nextIndex: cp.nextIndex + batch.length,
          processedTurns: cp.processedTurns + batch.length,
          totalTurns: cp.totalTurns,
        };
        const saved = await this.jobs.advance(job.id, owner, cp.nextIndex, next, {
          text: composed.text,
          coveredTurnIds: composed.coveredTurnIds,
        });
        if (!saved) throw cancelled();
        await traceEvent(root, 'rebuild_batch_committed', {
          jobId: job.id,
          batchTurnIds: batch.map((t) => t.id),
          priorBytes: composed.priorBytes,
          additionBytes: composed.additionBytes,
          resultBytes: composed.resultBytes,
        });
        cp = next;
        draft = composed.text;
        covered = composed.coveredTurnIds;
      }
      await this.alive(job, owner, ctl.signal);
      await this.finish(job, owner, draft, covered);
    } catch (error) {
      await traceEvent(runTrace, 'rebuild_stopped', {
        cancelled: ctl.signal.aborted,
        ...safeTraceFailure(error),
      });
      if (ctl.signal.aborted || (error instanceof Problem && error.code === 'cancelled')) return;
      reportProcessingFailure('memory_rebuild', error);
      const problem =
        error instanceof z.ZodError
          ? new Problem(
              502,
              MemoryRebuildError.Invalid,
              'The CLI returned an unusable summary; retry the rebuild.'
            )
          : operationalProblem(error);
      await this.jobs
        .fail(job.id, owner, problem.code, problem.message)
        .catch((e) => reportProcessingFailure('memory_rebuild_finish', e));
    } finally {
      clearInterval(beat);
      this.aborts.delete(key);
    }
  }

  /** Mark ready only while the frozen source still describes the campaign. */
  private async finish(
    job: MemoryRebuildJobRow,
    owner: string,
    text: string,
    covered: string[]
  ): Promise<void> {
    const c = await this.store.campaign(job.campaignId);
    const turns = await this.store.activeTurns(job.campaignId);
    const live = sourceIdentity(captureRebuildInput(c, turns));
    if (live !== job.sourceIdentity) {
      const failed = await this.jobs.fail(
        job.id,
        owner,
        MemoryRebuildError.Stale,
        'The story changed while rebuilding; start a new rebuild'
      );
      if (!failed) throw cancelled();
      return;
    }
    const digest = proposalDigest({
      candidateText: text,
      coveredTurnIds: covered,
      sourceIdentity: job.sourceIdentity,
      targetIdentity: job.targetIdentity,
    });
    if (!(await this.jobs.ready(job.id, owner, digest))) throw cancelled();
  }

  /** Sequential section -> chapter -> overview generation, persisted after every step. */
  private async runCompact(
    job: MemoryRebuildJobRow,
    owner: string,
    frozen: FrozenRebuildInput,
    generator: Generator,
    signal: AbortSignal,
    root: PromptTraceContext,
    indexed?: { offset: number }
  ): Promise<void> {
    const plan = planHistory(frozen.turns, RECENT_GAMEPLAY_TURN_COUNT);
    const locators = new Map((frozen.versions ?? []).map((v) => [v.turnId, v] as const));
    const locatorOf = (index: number): SourceLocator => {
      const found = locators.get(frozen.turns[index]!.id);
      if (!found) throw new Problem(409, MemoryRebuildError.Stale, 'A source version is missing');
      return found;
    };
    const corrections = frozen.corrections;
    const correctionDigest = correctionDigestOf(corrections);
    const staged = (job.staged ?? []) as StagedFragment[];
    const reusable = indexed
      ? await new HistoryStore(this.store).list(job.campaignId, undefined, true)
      : [];
    let cp = indexed
      ? { ...job.checkpoint, nextIndex: Math.max(0, job.checkpoint.nextIndex - indexed.offset) }
      : job.checkpoint;
    const linksFor = (indexes: number[]) => {
      const text = indexes
        .map((i) => `${frozen.turns[i]!.player} ${frozen.turns[i]!.gm}`)
        .join(' ')
        .toLocaleLowerCase();
      return frozen.knowledge
        .filter((k) => k.title && text.includes(k.title.toLocaleLowerCase()))
        .map((k) => k.id);
    };
    const reuse = (kind: HistoryFragmentKind, indexes: number[]) => {
      const sources = indexes.map(locatorOf);
      return reusable.find(
        (fragment) =>
          fragment.kind === kind &&
          fragment.correctionDigest === correctionDigest &&
          fragment.derivationDigest === derivationDigest(kind, sources, corrections) &&
          canonicalJson(fragment.sources) === canonicalJson(sources)
      );
    };
    const covered = () => [
      ...new Set(
        staged
          .filter((f) => f.kind === HistoryFragmentKind.Section)
          .flatMap((f) => f.sources.map((x) => x.turnId))
      ),
    ];
    while (cp.nextIndex < plan.length) {
      await this.alive(job, owner, signal);
      const i = cp.nextIndex;
      const step = plan[i]!;
      const historyStepStartedAt = Date.now();
      await traceEvent(root, 'history_step_start', {
        step: i,
        kind: step.kind,
        totalSteps: plan.length,
      });
      let fragment: StagedFragment;
      if (step.kind === HistoryStepKind.Section) {
        const previous = [...staged].reverse().find((f) => f.kind === HistoryFragmentKind.Section);
        const out =
          reuse(HistoryFragmentKind.Section, step.turns) ??
          historySectionSchema.parse(
            await this.generate(
              generator,
              frozen.settings,
              sectionPrompt(
                step.turns.map((t) => frozen.turns[t]!),
                previous?.text ?? '',
                corrections
              ),
              signal,
              root,
              historySectionJsonSchema
            )
          );
        const sources = step.turns.map(locatorOf);
        fragment = {
          kind: HistoryFragmentKind.Section,
          title: out.title,
          text: out.text,
          sources,
          parentIds: [],
          derivationDigest: derivationDigest(HistoryFragmentKind.Section, sources, corrections),
          correctionDigest,
          links: linksFor(step.turns),
        };
      } else if (step.kind === HistoryStepKind.Chapter) {
        const turnIndexes = step.sections.flatMap((s) => (plan[s] as { turns: number[] }).turns);
        const out =
          reuse(HistoryFragmentKind.Chapter, turnIndexes) ??
          historySectionSchema.parse(
            await this.generate(
              generator,
              frozen.settings,
              chapterPrompt(
                turnIndexes.map((t) => frozen.turns[t]!),
                step.sections.map((s) => staged[s]!.title),
                corrections
              ),
              signal,
              root,
              historySectionJsonSchema
            )
          );
        const sources = turnIndexes.map(locatorOf);
        fragment = {
          kind: HistoryFragmentKind.Chapter,
          title: out.title,
          text: out.text,
          sources,
          parentIds: step.sections.map(stagedRef),
          derivationDigest: derivationDigest(HistoryFragmentKind.Chapter, sources, corrections),
          correctionDigest,
          links: linksFor(turnIndexes),
        };
      } else {
        const chapters = staged.filter((f) => f.kind === HistoryFragmentKind.Chapter);
        const basis = chapters.length
          ? chapters
          : staged.filter((f) => f.kind === HistoryFragmentKind.Section);
        const protectedIds = new Set(frozen.protectedKnowledgeIds ?? []);
        const out = historyOverviewSchema.parse(
          await this.generate(
            generator,
            frozen.settings,
            overviewPrompt(
              basis.map(({ title, text }) => ({ title, text })),
              frozen.knowledge
                .filter((k) => protectedIds.has(k.id))
                .map(({ title, text }) => ({ title, text })),
              corrections
            ),
            signal,
            root,
            historyOverviewJsonSchema
          )
        );
        const sources = staged
          .filter((f) => f.kind === HistoryFragmentKind.Section)
          .flatMap((f) => f.sources);
        fragment = {
          kind: HistoryFragmentKind.Overview,
          title: 'Story so far',
          text: out.text,
          sources,
          parentIds: basis.map((f) => stagedRef(staged.indexOf(f))),
          derivationDigest: derivationDigest(HistoryFragmentKind.Overview, sources, corrections),
          correctionDigest,
          links: [],
        };
      }
      staged.push(fragment);
      const next = {
        nextIndex: i + 1 + (indexed?.offset ?? 0),
        processedTurns: i + 1 + (indexed?.offset ?? 0),
        totalTurns: indexed ? job.checkpoint.totalTurns : plan.length,
      };
      const overview = staged.find((f) => f.kind === HistoryFragmentKind.Overview);
      const saved = await this.jobs.advance(job.id, owner, i + (indexed?.offset ?? 0), next, {
        text: overview?.text ?? '',
        coveredTurnIds: covered(),
        staged,
        ...(job.gmIndexProposal ? { gmIndex: job.gmIndexProposal } : {}),
        ...(job.indexReadInvocations ? { indexReadInvocations: job.indexReadInvocations } : {}),
      });
      if (!saved) throw cancelled();
      await traceEvent(root, 'history_step_checkpoint', {
        step: i,
        kind: step.kind,
        elapsedMs: Date.now() - historyStepStartedAt,
        completedSteps: next.nextIndex,
        totalSteps: next.totalTurns,
      });
      cp = indexed ? { ...next, nextIndex: next.nextIndex - indexed.offset } : next;
    }
    await this.alive(job, owner, signal);
    const overview = staged.find((f) => f.kind === HistoryFragmentKind.Overview);
    // The digest binds the overview text and every staged fragment the review shows.
    if (indexed) return;
    await this.finish(
      job,
      owner,
      `${overview?.text ?? ''}\n${sha256(canonicalJson(staged))}`,
      covered()
    );
  }

  // ---------------------------------------------------------------- decisions
  private async runGmIndex(
    job: MemoryRebuildJobRow,
    owner: string,
    capture: GmIndexGenerationCapture,
    generator: Generator,
    signal: AbortSignal,
    root: PromptTraceContext
  ): Promise<void> {
    await requireGmIndexTransport(generator, capture.campaign.settings);
    const batches = gmIndexScanBatches(capture);
    let drafts = job.foundationDrafts ?? [];
    const indexReadInvocations = job.indexReadInvocations ?? [];
    for (const reads of indexReadInvocations) restoreGmIndexSourceReads(capture.campaign, reads);
    const alive = () => this.alive(job, owner, signal);
    const history = {
      campaignId: job.campaignId,
      mode: 'compact' as const,
      turnVersions: capture.versions,
      fragments: [],
      correctionGuidance: correctionGuidance(capture.campaign),
      protectedLocators: [],
      selectionDiagnostics: {
        targetBytes: HISTORY_DEFAULTS.optionalHistoryBytes,
        suppliedBytes: 0,
        mandatoryBytes: 0,
        overflowBytes: 0,
        included: [],
        omitted: { count: 0, reasonCounts: {} },
      },
    };
    const invoke = async (
      prompt: string,
      schema: z.ZodType,
      purpose: string,
      suppliedSourceSections: import('./gmIndexReadTools.js').GmIndexSourceSection[] = [],
      validateOutput?: (output: unknown) => void
    ) => {
      let feedback = '';
      for (let attempt = 0; ; attempt++) {
        await alive();
        const invocationStartedAt = Date.now();
        const activeStep = (await this.jobs.get(job.campaignId, job.id)).checkpoint.nextIndex;
        await traceEvent(root, 'gm_index_stage_start', {
          purpose,
          step: activeStep,
          attempt,
          promptBytes: Buffer.byteLength(prompt, 'utf8'),
        });
        const reads: GmIndexReadReceipt[] = [];
        indexReadInvocations.push(reads);
        const tools = createGmIndexReadTools(
          this.store,
          capture.campaign,
          history,
          alive,
          async (read) => {
            reads.push(read);
            await traceEvent(root, 'gm_index_read_complete', {
              purpose,
              readNumber: reads.length,
              ...gmIndexReadSummary(read),
              elapsedMs: Date.now() - invocationStartedAt,
            });
            const current = await this.jobs.get(job.campaignId, job.id);
            if (
              !(await this.jobs.advance(
                job.id,
                owner,
                current.checkpoint.nextIndex,
                current.checkpoint,
                {
                  text: current.candidateText ?? '',
                  coveredTurnIds: current.candidateCoveredTurnIds ?? [],
                  staged: current.staged ?? [],
                  ...(current.gmIndexMergeOutput !== undefined
                    ? { gmIndexMergeOutput: current.gmIndexMergeOutput }
                    : {}),
                  foundationDrafts: drafts,
                  ...(current.gmIndexProposal ? { gmIndex: current.gmIndexProposal } : {}),
                  indexReadInvocations,
                }
              ))
            )
              throw cancelled();
          },
          [],
          [],
          {
            originalsOnly: true,
            suppliedSourceSections,
            onReadStarted: (name) =>
              traceEvent(root, 'gm_index_read_start', {
                purpose,
                tool: name,
                readNumber: reads.length + 1,
              }),
          }
        );
        try {
          const result = await generator.generateOwnedGameplay!(
            capture.campaign.settings,
            feedback
              ? JSON.stringify({ ...JSON.parse(prompt), validationFeedback: feedback })
              : prompt,
            z.toJSONSchema(schema),
            GM_INDEX_PREPARATION_INSTRUCTIONS,
            tools,
            signal,
            { ...root, executionId: randomUUID(), purpose, correctionAttempt: attempt }
          );
          await alive();
          if (purpose === 'gm_index_prepare') {
            const current = await this.jobs.get(job.campaignId, job.id);
            if (
              !(await this.jobs.advance(
                job.id,
                owner,
                current.checkpoint.nextIndex,
                current.checkpoint,
                {
                  text: current.candidateText ?? '',
                  coveredTurnIds: current.candidateCoveredTurnIds ?? [],
                  staged: current.staged ?? [],
                  foundationDrafts: drafts,
                  indexReadInvocations,
                  gmIndexMergeOutput: result,
                }
              ))
            )
              throw cancelled();
            await traceEvent(root, 'gm_index_merge_output_saved', { step: activeStep, attempt });
          }
          const validated = schema.parse(
            normalizeGmIndexGenerationRefs(
              capture,
              purpose === 'gm_index_prepare' ? normalizeGmIndexPreparationOutput(result) : result
            )
          );
          validateOutput?.(validated);
          await traceEvent(root, 'gm_index_stage_complete', {
            purpose,
            retrievalCalls: reads.length,
            emptySearches: reads.filter((read) => gmIndexReadSummary(read).empty).length,
            elapsedMs: Date.now() - invocationStartedAt,
          });
          return validated;
        } catch (error) {
          await traceEvent(root, 'gm_index_stage_failed', {
            purpose,
            step: activeStep,
            elapsedMs: Date.now() - invocationStartedAt,
            ...safeTraceFailure(error),
          });
          const reason = structuredResponseRetryFeedback(error);
          if (signal.aborted || reason === null || attempt >= RESPONSE_RETRY_COUNT) throw error;
          await alive();
          feedback = `Previous output failed validation: ${reason}. Return complete strict JSON matching the supplied schema. No trailing commas, comments, markdown or extra prose. Correct only this same batch/stage; already completed work stays saved. Use owned references and the supplied originals.`;
          await traceEvent(root, 'response_validation_retry', {
            purpose,
            step: activeStep,
            nextAttempt: attempt + 1,
            ...safeTraceFailure(error),
          });
        }
      }
    };
    let nextIndex = job.checkpoint.nextIndex;
    for (let i = nextIndex; i < batches.length; i++) {
      const out = (await invoke(
        gmIndexScanPrompt(capture, batches[i]),
        gmIndexScanSchema,
        'gm_index_scan',
        ((batch: unknown) => {
          const section = batch as {
            kind: string;
            sourceId: string;
            version: number;
            sectionIndex: number;
          };
          return section.kind === 'source_original'
            ? [
                {
                  sourceId: section.sourceId,
                  version: section.version,
                  sectionIndex: section.sectionIndex,
                },
              ]
            : [];
        })(batches[i])
      )) as z.infer<typeof gmIndexScanSchema>;
      drafts = [
        ...drafts,
        ...out.foundation,
        ...out.entries.map((workingEntry) => ({ workingEntry })),
      ];
      nextIndex = i + 1;
      await traceEvent(root, 'gm_index_batch_checkpoint', {
        completedSteps: nextIndex,
        totalSteps: job.checkpoint.totalTurns,
        draftItems: drafts.length,
      });
      if (
        !(await this.jobs.advance(
          job.id,
          owner,
          i,
          { nextIndex, processedTurns: nextIndex, totalTurns: job.checkpoint.totalTurns },
          { text: '', coveredTurnIds: [], foundationDrafts: drafts, indexReadInvocations }
        ))
      )
        throw cancelled();
    }
    if (nextIndex === batches.length) {
      let output = job.gmIndexMergeOutput;
      if (output !== undefined) {
        try {
          gmIndexPreparedDocument(capture, output);
          await traceEvent(root, 'gm_index_saved_merge_reused', { step: nextIndex });
        } catch (error) {
          await traceEvent(root, 'gm_index_saved_merge_rejected', safeTraceFailure(error));
          output = undefined;
        }
      }
      if (output === undefined)
        output = await invoke(
          JSON.stringify({
            stage: 'synthesize',
            scannedFoundation: drafts.filter(
              (draft) => !(draft && typeof draft === 'object' && 'workingEntry' in draft)
            ),
            scannedWorkingEntries: drafts.flatMap((draft) =>
              draft && typeof draft === 'object' && 'workingEntry' in draft
                ? [draft.workingEntry]
                : []
            ),
            currentState: capture.campaign.state,
            canonicalKnowledge: capture.campaign.knowledge ?? [],
            characters: capture.campaign.characters.map(
              ({ notes: _notes, revision: _revision, ...character }) => character
            ),
            npcCores: capture.campaign.continuity?.npcProfiles ?? [],
            lastTurns: capture.turns.slice(-RECENT_GAMEPLAY_TURN_COUNT).map(turnVersionOf),
            corrections: correctionGuidance(capture.campaign),
            task: 'Consolidate a new compact foundation and working index, current pending tasks and clues, campaign-grounded directions and optional creative hooks. Plans are tentative. The entire captured campaign/history has been scanned; retrieve exact originals if needed.',
          }),
          gmIndexPreparationSchema,
          'gm_index_prepare',
          [],
          (output) => {
            gmIndexPreparedDocument(capture, output);
          }
        );
      const document = gmIndexPreparedDocument(capture, output);
      const gmIndex = {
        document,
        preview: gmIndexPreview(capture.campaign, capture.turns),
        reads: [],
      };
      nextIndex++;
      if (
        !(await this.jobs.advance(
          job.id,
          owner,
          batches.length,
          { nextIndex, processedTurns: nextIndex, totalTurns: job.checkpoint.totalTurns },
          { text: '', coveredTurnIds: [], gmIndex, indexReadInvocations }
        ))
      )
        throw cancelled();
    }
    const row = await this.jobs.get(job.campaignId, job.id);
    const frozen = {
      ...captureRebuildInput(capture.campaign, capture.turns),
      versions: capture.versions,
      protectedKnowledgeIds: historySettingsOf(capture.campaign).protectedKnowledgeIds,
    };
    await this.runCompact(row, owner, frozen, generator, signal, root, {
      offset: batches.length + 1,
    });
    const ready = await this.jobs.get(job.campaignId, job.id);
    if (!ready.gmIndexProposal)
      throw new Problem(409, MemoryRebuildError.Invalid, 'Prepared GM index is missing.');
    await alive();
    const digest = gmIndexPreparationDigest(
      ready.gmIndexProposal.document,
      ready.gmIndexProposal.preview,
      job.sourceIdentity,
      job.targetIdentity,
      ready.staged ?? []
    );
    if (!(await this.jobs.ready(job.id, owner, digest))) throw cancelled();
    await traceEvent(root, 'gm_index_ready', {
      completedSteps: ready.checkpoint.nextIndex,
      totalSteps: ready.checkpoint.totalTurns,
    });
  }

  async apply(
    campaignId: string,
    jobId: string,
    requestId: string,
    digest: string,
    preserveMemory = false
  ): Promise<MemoryRebuildApplyResult> {
    const identity = identityOf(MemoryRebuildAction.Apply, {
      digest,
      ...(preserveMemory ? { preserveMemory } : {}),
    });
    const saved = await this.savedDecision(
      campaignId,
      jobId,
      MemoryRebuildAction.Apply,
      requestId,
      identity
    );
    if (saved) return saved;
    const beforeApply = await this.jobs.get(campaignId, jobId);
    if (beforeApply.purpose === MemoryRebuildPurpose.GmIndex)
      await requireGmIndexTransport(
        await this.requireProvider((await this.store.campaign(campaignId)).settings),
        (await this.store.campaign(campaignId)).settings
      );
    return this.store.transaction(async (client) => {
      const c = await this.store.campaign(campaignId, client, true);
      const job = await this.jobs.get(campaignId, jobId, client, true);
      const again = await this.savedDecision(
        campaignId,
        jobId,
        MemoryRebuildAction.Apply,
        requestId,
        identity,
        client
      );
      if (again) return again;
      if (job.status !== MemoryRebuildStatus.Ready || job.candidateText === null)
        throw new Problem(409, MemoryRebuildError.Invalid, 'There is no finished draft to apply');
      await this.store.assertIdle(campaignId, client);
      if (job.purpose === MemoryRebuildPurpose.GmIndex) {
        const turns = await this.store.activeTurns(campaignId, client);
        const proposal = job.gmIndexProposal;
        const capture = job.frozenInput as unknown as GmIndexGenerationCapture;
        if (
          !proposal ||
          gmIndexGenerationSourceIdentity(c, turns) !== job.sourceIdentity ||
          gmIndexGenerationTargetIdentity(c) !== job.targetIdentity ||
          gmIndexPreparationDigest(
            proposal.document,
            proposal.preview,
            job.sourceIdentity,
            job.targetIdentity,
            job.staged ?? []
          ) !== digest ||
          digest !== job.proposalDigest
        )
          throw new Problem(
            409,
            MemoryRebuildError.Stale,
            'The campaign or index changed after preparation; rebuild and review again.'
          );
        const baseline = { enabled: historySettingsOf(c).enabled, modeDecisionId: requestId };
        const retainedRebuildSettings =
          capture.mode === GmIndexPreparationMode.FreshRebuild
            ? capture.retainedSettings
            : undefined;
        if (!retainedRebuildSettings) {
          if (job.staged?.length) await this.activateHistory(c, job, client, false);
          else c.historyRecall = { ...historySettingsOf(c), enabled: true, activeOverviewId: null };
        }
        c.gmIndex = {
          settings: retainedRebuildSettings ?? {
            enabled: true,
            activationHistoryBaseline: capture.retainedSettings?.enabled
              ? capture.retainedSettings.activationHistoryBaseline
              : baseline,
          },
          document: proposal.document,
        };
        c.revision++;
        await this.store.save(c, client);
        await this.jobs.decide(client, jobId, MemoryRebuildAction.Apply, requestId, null);
        await this.jobs.insertReceipt(client, {
          jobId,
          action: MemoryRebuildAction.Apply,
          requestId,
          identityDigest: identity,
          attemptOwner: null,
          result: { generationId: proposal.document.generationId },
        });
        return {
          campaign: publicCampaign(c),
          job: this.view(await this.jobs.get(campaignId, jobId, client)),
        };
      }
      const turns = await this.store.activeTurns(campaignId, client);
      const coveredNow = turns.map((t) => t.id);
      // Concrete identities, not revision counters: unrelated edits must not reject the draft.
      const compact = job.purpose === MemoryRebuildPurpose.CompactHistory;
      const staleReason =
        sourceIdentity(captureRebuildInput(c, turns)) !== job.sourceIdentity
          ? 'The story or its corrections changed after this draft was made; rebuild again'
          : (compact ? compactTargetIdentity(c) : targetIdentity(c.memory)) !== job.targetIdentity
            ? 'The saved memory changed after this draft was made; rebuild again'
            : null;
      if (staleReason) throw new Problem(409, MemoryRebuildError.Stale, staleReason);
      const expected = proposalDigest({
        candidateText: compact
          ? `${job.candidateText}\n${sha256(canonicalJson(job.staged ?? []))}`
          : job.candidateText,
        coveredTurnIds: job.candidateCoveredTurnIds ?? [],
        sourceIdentity: job.sourceIdentity,
        targetIdentity: job.targetIdentity,
      });
      if (expected !== digest || expected !== job.proposalDigest)
        throw new Problem(
          409,
          MemoryRebuildError.Stale,
          'The draft changed; review the current draft before applying'
        );
      if (compact) {
        const activated = await this.activateHistory(c, job, client, preserveMemory);
        if (c.gmIndex)
          c.gmIndex.settings.activationHistoryBaseline = {
            enabled: true,
            modeDecisionId: requestId,
          };
        c.revision++;
        await this.store.save(c, client);
        await this.jobs.decide(client, jobId, MemoryRebuildAction.Apply, requestId, null);
        await this.jobs.insertReceipt(client, {
          jobId,
          action: MemoryRebuildAction.Apply,
          requestId,
          identityDigest: identity,
          attemptOwner: null,
          result: { overviewId: activated },
        });
        return {
          campaign: publicCampaign(c),
          job: this.view(await this.jobs.get(campaignId, jobId, client)),
        };
      }
      if (canonicalJson(job.candidateCoveredTurnIds) !== canonicalJson(coveredNow))
        throw new Problem(
          409,
          MemoryRebuildError.Stale,
          'The draft no longer covers the whole story; rebuild again'
        );
      const memory: Memory = {
        id: randomUUID(),
        text: job.candidateText,
        coveredTurnIds: coveredNow,
        valid: true,
        createdAt: new Date().toISOString(),
      };
      await this.store.memory(c, memory, client);
      c.revision++;
      await this.store.save(c, client);
      await this.jobs.decide(client, jobId, MemoryRebuildAction.Apply, requestId, memory.id);
      await this.jobs.insertReceipt(client, {
        jobId,
        action: MemoryRebuildAction.Apply,
        requestId,
        identityDigest: identity,
        attemptOwner: null,
        result: { memoryId: memory.id },
      });
      return {
        campaign: publicCampaign(c),
        job: this.view(await this.jobs.get(campaignId, jobId, client)),
      };
    });
  }

  /**
   * Publish the staged fragments, retire the previous index (kept for audit and frozen retries)
   * and switch selective history on. Archival memory is never replaced.
   */
  private async activateHistory(
    c: Campaign,
    job: MemoryRebuildJobRow,
    client: Parameters<MemoryRebuildJobStore['receipt']>[3] & object,
    preserveMemory: boolean
  ): Promise<string> {
    const history = new HistoryStore(this.store);
    const staged = (job.staged ?? []) as StagedFragment[];

    if (!staged.some((f) => f.kind === HistoryFragmentKind.Overview))
      throw new Problem(409, MemoryRebuildError.Invalid, 'The staged index has no overview');
    const previous = (await history.list(c.id, client)).filter(
      (f) => f.selection === HistorySelectionStatus.Valid
    );
    await client.query(
      "UPDATE history_fragments SET selection_status='stale' WHERE campaign_id=$1 AND selection_status='valid'",
      [c.id]
    );
    const published: string[] = [];
    for (const fragment of staged) {
      const [created] = await history.publish(client, c.id, [
        {
          ...fragment,
          parentIds: fragment.parentIds.map(
            (ref) => published[Number(ref.replace('staged:', ''))]!
          ),
        },
      ]);
      published.push(created!.id);
    }
    const settings = structuredClone(historySettingsOf(c));
    // A pin follows its replacement by identical source locators; otherwise it stays and shows unavailable.
    const signature = (sources: SourceLocator[]) => sources.map((x) => x.turnId).join(',');
    const bySources = new Map(
      staged.map((f, i) => [f.kind + signature(f.sources), published[i]!] as const)
    );
    settings.protectedSectionIds = settings.protectedSectionIds.map((id) => {
      const old = previous.find((f) => f.id === id);
      return (old && bySources.get(old.kind + signature(old.sources))) ?? id;
    });
    if (preserveMemory && c.memory?.valid && !settings.protectedMemoryIds.includes(c.memory.id))
      settings.protectedMemoryIds.push(c.memory.id);
    const overviewId = published[staged.findIndex((f) => f.kind === HistoryFragmentKind.Overview)]!;
    settings.enabled = true;
    settings.activeOverviewId = overviewId;
    c.historyRecall = settings;
    return overviewId;
  }

  async discard(
    campaignId: string,
    jobId: string,
    requestId: string
  ): Promise<MemoryRebuildApplyResult> {
    const identity = identityOf(MemoryRebuildAction.Discard);
    const saved = await this.savedDecision(
      campaignId,
      jobId,
      MemoryRebuildAction.Discard,
      requestId,
      identity
    );
    if (saved) return saved;
    return this.store.transaction(async (client) => {
      const c = await this.store.campaign(campaignId, client, true);
      const job = await this.jobs.get(campaignId, jobId, client, true);
      const again = await this.savedDecision(
        campaignId,
        jobId,
        MemoryRebuildAction.Discard,
        requestId,
        identity,
        client
      );
      if (again) return again;
      if (!statusOption(job.status).actions.some((a) => a === MemoryRebuildAction.Discard))
        throw new Problem(409, MemoryRebuildError.Invalid, 'This rebuild cannot be discarded');
      await this.jobs.decide(client, jobId, MemoryRebuildAction.Discard, requestId, null);
      await this.jobs.insertReceipt(client, {
        jobId,
        action: MemoryRebuildAction.Discard,
        requestId,
        identityDigest: identity,
        attemptOwner: null,
        result: null,
      });
      return {
        campaign: publicCampaign(c),
        job: this.view(await this.jobs.get(campaignId, jobId, client)),
      };
    });
  }

  /** Replays a decision for the same request; any other final decision on the job is a conflict. */
  private async savedDecision(
    campaignId: string,
    jobId: string,
    action: MemoryRebuildReceiptAction,
    requestId: string,
    identity: string,
    client?: Parameters<MemoryRebuildJobStore['receipt']>[3]
  ): Promise<MemoryRebuildApplyResult | null> {
    const own = await this.jobs.receipt(jobId, action, requestId, client);
    const job = await this.jobs.get(campaignId, jobId, client);
    if (own) {
      if (own.identityDigest !== identity)
        throw new Problem(
          409,
          MemoryRebuildError.RequestReused,
          'Request ID was already used with different input; generate a new ID'
        );
      return {
        campaign: publicCampaign(await this.store.campaign(campaignId, client)),
        job: this.view(job),
      };
    }
    if (job.decision)
      throw new Problem(
        409,
        MemoryRebuildError.RequestReused,
        'This memory rebuild already has a final decision'
      );
    return null;
  }
}

const frozenSchema = z.custom<FrozenRebuildInput>(
  (v) => typeof v === 'object' && v !== null && Array.isArray((v as { turns?: unknown }).turns)
);
