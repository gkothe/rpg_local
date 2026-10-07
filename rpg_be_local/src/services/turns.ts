import { bindResponseCitations } from '../domain/citationBinding.js';
import { atResponseField } from '../domain/responseFields.js';
import { validateWithFieldRepair } from './responseRepair.js';
import { sourceSpanSchema } from '../domain/knowledge.js';
import { CampaignSourceLookup } from './campaignSourceLookup.js';
import { NarrativeCandidateRepository, humanizeNarrative } from './narrativeHumanizer.js';
import { createPromptTrace, traceEvent, type PromptTraceContext } from '../providers/promptLog.js';
import {
  gameplayResponseInputSchema,
  gameplayResponseSchema,
  gameplayResponseWireJsonSchema,
  type GameplayResponse,
} from '../domain/gameplayResponse.js';
import { CombatPreparationService } from './combatPreparation.js';
import {
  operationalProblem,
  reportProcessingFailure,
  safeProcessingFailure,
} from '../processingErrors.js';
import { isDeepStrictEqual } from 'node:util';
import { freezeKnowledge } from '../domain/knowledgeRecall.js';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { Store, ownerId } from '../store.js';
import { withResponseRetries } from '../domain/responseRetry.js';
import { Problem, conflict } from '../errors.js';
import type { Campaign, Turn, ProviderSettings, Memory } from '../domain/types.js';
import type { Generator } from '../providers/service.js';
import type { GameplayToolDefinition } from '../providers/gameplayTools.js';
import {
  buildContext,
  compactionBatch,
  recentGameplayHistory,
  olderHistoryBytes,
} from '../domain/context.js';
import { memoryJsonSchema, memorySchema } from '../domain/schemas.js';
import { composeMemory } from '../domain/memory.js';
import { HistoryReader, HistoryStore } from './historyStore.js';
import { historySettingsOf } from '../domain/historyRecall.js';
import { applyResponse, undoSnapshot } from '../domain/state.js';
import { assertFrozenContext } from '../domain/journalCompatibility.js';
import {
  assertNoCorrectionEvidence,
  assertNoLaterCorrection,
  reconcileBackfillUndo,
} from '../domain/journalChanges.js';
import { TurnStatus } from '../domain/options.js';
import { DiceService, gameplayDigest } from './dice.js';
import { validateRollInterpretations, validateRollPlacement } from '../domain/diceResponse.js';
import { validateRuleCitations } from '../domain/ruleCitationValidation.js';
import { RuleStore, ruleContext } from './ruleStore.js';
import { RuleLookup } from './ruleLookup.js';
import { generateRuleMapping } from '../domain/ruleMapping.js';
import {
  RuleSystemKind,
  type RuleSystem,
  type RulePrompt,
  type RuleRead,
} from '../domain/rules.js';
import { GameplayTools } from '../providers/gameplayTools.js';
const TURN_LEASE_SECONDS = 45;
const TURN_HEARTBEAT_INTERVAL_MS = 10_000;
const AUTO_COMPACTION_HISTORY_THRESHOLD_BYTES = 6_000;
export class TurnService {
  private aborts = new Map<string, AbortController>();
  constructor(
    readonly store: Store,
    readonly generator: Generator
  ) {}
  private gameplayCapacity(settings: ProviderSettings, ceiling: number): Promise<number> {
    return (
      this.generator.gameplayCapacity?.(settings, ceiling) ??
      this.generator.capacity(settings, ceiling)
    );
  }
  private rulePrompt(system: RuleSystem): RulePrompt {
    return {
      context: ruleContext(system),
      instructions: system.instructions,
      overview: system.kind === RuleSystemKind.Library ? generateRuleMapping(system).overview : '',
    };
  }
  private async selectedCapacity(
    campaign: Campaign,
    settings: ProviderSettings,
    ceiling: number
  ): Promise<number> {
    const selected = await new RuleStore(this.store).resolve(campaign);
    if (selected.kind !== RuleSystemKind.Library) return this.gameplayCapacity(settings, ceiling);
    if (!this.generator.bookGameplayCapacity)
      throw new Problem(
        503,
        'rules_provider_unavailable',
        'Book gameplay is not verified for the selected CLI/model; explicitly choose the default or another supported provider'
      );
    return this.generator.bookGameplayCapacity(settings, ceiling);
  }
  async submit(
    campaignId: string,
    input: { revision: number; requestId: string; action: string; settings?: ProviderSettings }
  ): Promise<Turn> {
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    // Resolve local CLI capabilities outside the write transaction. Existing IDs replay even
    // when the provider has subsequently become unavailable.
    const prior = await this.store.pool.query(
      'SELECT payload_hash,document FROM turns WHERE campaign_id=$1 AND request_id=$2',
      [campaignId, input.requestId]
    );
    if (prior.rows[0]) {
      if (prior.rows[0].payload_hash !== hash)
        throw conflict('Request ID was already used with different input; generate a new ID');
      return this.store.turn(campaignId, prior.rows[0].document.id);
    }
    const initialCampaign = await this.store.campaign(campaignId);
    await this.selectedCapacity(
      initialCampaign,
      input.settings ?? initialCampaign.settings,
      Infinity
    );
    let launch = false;
    const turn = await this.store.transaction(async (client) => {
      const c = await this.store.campaign(campaignId, client, true);
      const existing = await client.query(
        'SELECT payload_hash,document FROM turns WHERE campaign_id=$1 AND request_id=$2',
        [campaignId, input.requestId]
      );
      if (existing.rows[0]) {
        if (existing.rows[0].payload_hash !== hash)
          throw conflict('Request ID was already used with different input; generate a new ID');
        return this.store.turn(campaignId, existing.rows[0].document.id, client);
      }
      await this.store.assertIdle(campaignId, client);
      const settings = input.settings ?? c.settings;
      const system = await new RuleStore(this.store).resolve(c, client);
      const t: Turn = {
        id: randomUUID(),
        campaignId,
        requestId: input.requestId,
        status: TurnStatus.Pending,
        action: input.action,
        narrative: null,
        changes: [],
        error: null,
        undone: false,
        settings: structuredClone(settings),
        context: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
        ruleContext: ruleContext(system),
      };
      const history = await this.store.activeTurns(c.id, client);
      const rules = await this.store.retrieve(c, t.action, client, sceneText(c));
      let context = null;
      try {
        context = buildContext(c, history, t.action, rules, this.rulePrompt(system));
      } catch (e) {
        if (!(e instanceof Problem && e.code === 'context_overflow')) throw e;
      }
      // Capture the complete immutable input; compaction may replace it only at the same revision.
      t.context = context ?? {
        revision: c.revision,
        prompt: '',
        estimatedTokens: 0,
        estimator: 'pending bounded compaction',
        sourceVersions: [],
        historyIds: history.map((x) => x.id),
        memoryId: c.memory?.id ?? null,
        ruleContext: t.ruleContext,
      };
      await client.query(
        "INSERT INTO turns(id,campaign_id,request_id,payload_hash,status,document,owner,lease_until) VALUES($1,$2,$3,$4,$5,$6,$7,now()+($8 * interval '1 second'))",
        [t.id, c.id, t.requestId, hash, t.status, t, ownerId, TURN_LEASE_SECONDS]
      );
      launch = true;
      return t;
    });
    if (launch)
      queueMicrotask(() => {
        void this.run(turn).catch((error) =>
          reportProcessingFailure('turn_background', error, turn.id)
        );
      });
    return turn;
  }
  private async lockedOwned(
    t: Turn,
    client: PoolClient
  ): Promise<{ campaign: Campaign; turn: Turn }> {
    const campaign = await this.store.campaign(t.campaignId, client, true);
    const turn = await this.store.turn(t.campaignId, t.id, client, true);
    const owner = await client.query('SELECT owner,lease_until FROM turns WHERE id=$1', [t.id]);
    if (
      owner.rows[0]?.owner !== ownerId ||
      new Date(owner.rows[0]?.lease_until).getTime() <= Date.now() ||
      ![TurnStatus.Pending, TurnStatus.Running].includes(turn.status as TurnStatus)
    )
      throw new Problem(409, 'cancelled', 'Turn is no longer active');
    if (t.ruleContext) await new RuleStore(this.store).guard(t.ruleContext, client);
    // A saved attempt must not replay facts a Journal correction has since superseded.
    assertFrozenContext(t.context?.frozenKnowledge, campaign);
    return { campaign, turn };
  }
  async retry(
    campaignId: string,
    turnId: string,
    input: { revision: number; requestId: string; settings?: ProviderSettings }
  ): Promise<Turn> {
    const hash = createHash('sha256')
      .update(JSON.stringify({ retryOf: turnId, ...input }))
      .digest('hex');
    const prior = await this.store.pool.query(
      'SELECT payload_hash,document FROM turns WHERE campaign_id=$1 AND request_id=$2',
      [campaignId, input.requestId]
    );
    if (prior.rows[0]) {
      if (prior.rows[0].payload_hash !== hash)
        throw conflict('Request ID was reused with different retry input');
      return this.store.turn(campaignId, prior.rows[0].document.id);
    }
    const initial = await this.store.campaign(campaignId);
    await this.selectedCapacity(initial, input.settings ?? initial.settings, Infinity);
    let launch = false;
    const next = await this.store.transaction(async (client) => {
      const campaign = await this.store.campaign(campaignId, client, true);
      const duplicate = await client.query(
        'SELECT payload_hash,document FROM turns WHERE campaign_id=$1 AND request_id=$2',
        [campaignId, input.requestId]
      );
      if (duplicate.rows[0]) {
        if (duplicate.rows[0].payload_hash !== hash)
          throw conflict('Request ID was reused with different retry input');
        return duplicate.rows[0].document as Turn;
      }
      await this.store.assertIdle(campaignId, client);
      const previous = await this.store.turn(campaignId, turnId, client, true);
      if (
        previous.ruleContext &&
        (await new RuleStore(this.store).resolve(campaign, client)).systemId !==
          previous.ruleContext.systemId
      )
        throw new Problem(
          409,
          'rules_context_changed',
          'Campaign rule selection changed; start a new action'
        );
      if (previous.ruleContext) await new RuleStore(this.store).guard(previous.ruleContext, client);
      if (
        ![TurnStatus.Failed, TurnStatus.Cancelled, TurnStatus.Interrupted].includes(
          previous.status as TurnStatus
        ) ||
        !previous.diceSessionId ||
        !previous.context
      )
        throw conflict('Only an unfinished local dice turn can be retried');
      const latest = await client.query(
        'SELECT id FROM turns WHERE campaign_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',
        [campaignId]
      );
      if (latest.rows[0]?.id !== previous.id)
        throw conflict('A later action superseded this attempt; start a new action');
      const session = await client.query(
        'SELECT * FROM dice_sessions WHERE id=$1 AND campaign_id=$2 FOR UPDATE',
        [previous.diceSessionId, campaignId]
      );
      const saved = session.rows[0];
      if (!saved || saved.imported || !saved.system_prompt)
        throw conflict(
          'Game context changed or this archive session is non-executable; start a new action'
        );
      assertFrozenContext(saved.frozen_knowledge, campaign);
      const turn: Turn = {
        ...previous,
        id: randomUUID(),
        requestId: input.requestId,
        status: TurnStatus.Pending,
        narrative: null,
        changes: [],
        error: null,
        rolls: [],
        rollInterpretations: [],
        undone: false,
        settings: structuredClone(input.settings ?? campaign.settings),
        retryOfTurnId: previous.id,
        context: {
          ...previous.context,
          prompt: saved.frozen_prompt,
          revision: campaign.revision,
          diceSessionId: saved.id,
          systemPrompt: saved.system_prompt,
          frozenKnowledge: saved.frozen_knowledge,
          ...(saved.frozen_sources ? { frozenSources: saved.frozen_sources } : {}),
          ...(saved.frozen_history ? { frozenHistory: saved.frozen_history } : {}),
        },
        createdAt: new Date().toISOString(),
        completedAt: null,
        ruleReads: [],
        ruleCitations: [],
      };
      delete turn.diceRetry;
      delete turn.editingResume;
      delete turn.editingPending;
      await client.query(
        "INSERT INTO turns(id,campaign_id,request_id,payload_hash,status,document,owner,lease_until) VALUES($1,$2,$3,$4,$5,$6,$7,now()+($8 * interval '1 second'))",
        [turn.id, campaignId, turn.requestId, hash, turn.status, turn, ownerId, TURN_LEASE_SECONDS]
      );
      await client.query(
        'INSERT INTO dice_attempts(turn_id,campaign_id,session_id) VALUES($1,$2,$3)',
        [turn.id, campaignId, turn.diceSessionId]
      );
      launch = true;
      return turn;
    });
    if (launch)
      queueMicrotask(() => {
        void this.run(next).catch((error) =>
          reportProcessingFailure('turn_background', error, next.id)
        );
      });
    return next;
  }
  async resumeEditing(
    campaignId: string,
    turnId: string,
    input: { revision: number; requestId: string }
  ): Promise<Turn> {
    let launch = false;
    const turn = await this.store.transaction(async (client) => {
      const campaign = await this.store.campaign(campaignId, client, true);
      const t = await this.store.turn(campaignId, turnId, client, true);
      const existing = await client.query(
        'SELECT candidate_digest FROM narrative_edit_requests WHERE turn_id=$1 AND request_id=$2',
        [turnId, input.requestId]
      );
      if (existing.rows.length) return t;
      if (!t.editingPending || !t.editingResume?.available)
        throw conflict(t.editingResume?.reason ?? 'No pending narrative editing is available');
      const repository = new NarrativeCandidateRepository(this.store.pool);
      const candidate = await repository.load(turnId, client);
      if (!candidate) throw conflict('Saved narrative context changed');
      if (t.ruleContext) await new RuleStore(this.store).guard(t.ruleContext, client);
      t.status = TurnStatus.Running;
      t.error = null;
      t.completedAt = null;
      const saved = await client.query(
        'SELECT * FROM dice_sessions WHERE id=$1 AND campaign_id=$2',
        [t.diceSessionId, campaignId]
      );
      const session = saved.rows[0];
      if (!session?.system_prompt) throw conflict('Saved editing context is missing');
      assertFrozenContext(session.frozen_knowledge, campaign);
      t.context = {
        ...t.context!,
        prompt: session.frozen_prompt,
        revision: session.frozen_revision,
        systemPrompt: session.system_prompt,
        frozenKnowledge: session.frozen_knowledge,
        frozenSources: session.frozen_sources,
        ...(session.frozen_history ? { frozenHistory: session.frozen_history } : {}),
      };
      await client.query(
        "UPDATE turns SET owner=$2,lease_until=now()+($3*interval '1 second') WHERE id=$1",
        [turnId, ownerId, TURN_LEASE_SECONDS]
      );
      await this.store.saveTurn(t, client);
      await repository.claim(turnId, ownerId, candidate.candidateDigest, input.requestId, client);
      launch = true;
      return t;
    });
    if (launch)
      queueMicrotask(() => {
        void this.run(turn).catch((error) =>
          reportProcessingFailure('narrative_resume', error, turn.id)
        );
      });
    return turn;
  }
  private async run(t: Turn): Promise<void> {
    const ctl = new AbortController();
    this.aborts.set(t.id, ctl);
    let trace: PromptTraceContext | undefined;
    let heartbeatBusy = false;
    let heartbeatFailure: unknown;
    const heartbeat = setInterval(() => {
      if (heartbeatBusy || ctl.signal.aborted) return;
      heartbeatBusy = true;
      void this.store
        .transaction(async (client) => {
          await this.lockedOwned(t, client);
          await client.query(
            "UPDATE turns SET lease_until=now()+($4 * interval '1 second') WHERE id=$1 AND owner=$2 AND status IN ($3,$5)",
            [t.id, ownerId, TurnStatus.Pending, TURN_LEASE_SECONDS, TurnStatus.Running]
          );
        })
        .catch((error) => {
          heartbeatFailure = error;
          ctl.abort();
        })
        .finally(() => {
          heartbeatBusy = false;
        });
    }, TURN_HEARTBEAT_INTERVAL_MS);
    try {
      const executionId = randomUUID();
      trace = {
        executionId,
        runId: t.id,
        campaignId: t.campaignId,
        turnId: t.id,
        purpose: t.editingPending ? 'narrative_humanize' : 'gameplay',
      };
      trace.trace = await createPromptTrace('gameplay', trace);
      t.traceId = executionId;
      if (t.editingPending) {
        await this.finishEditing(t, ctl.signal, trace);
        return;
      }
      await this.store.transaction(async (client) => {
        const { turn } = await this.lockedOwned(t, client);
        turn.status = TurnStatus.Running;
        await this.store.saveTurn(turn, client);
      });
      let c = await this.store.campaign(t.campaignId);
      let history = await this.store.activeTurns(c.id);
      await this.selectedCapacity(c, t.settings, Infinity);
      let needs =
        olderHistoryBytes(c, history) > AUTO_COMPACTION_HISTORY_THRESHOLD_BYTES ||
        !t.context?.prompt;
      // Each bounded batch covers a consecutive prefix; never recursively summarizes the full transcript.
      while (!t.retryOfTurnId && needs && recentGameplayHistory(c, history).older.length > 0) {
        const compactionCapacity = await this.generator.capacity(t.settings, c.budgets.compaction);
        const batch = compactionBatch(
          c,
          history,
          Math.min(c.budgets.compaction, compactionCapacity)
        );
        if (!batch.turns.length) break;
        const batchIds = batch.turns.map((x) => x.id);
        const childTrace: PromptTraceContext | undefined = trace && {
          ...trace,
          executionId: randomUUID(),
          purpose: 'memory_compaction',
        };
        await traceEvent(childTrace, 'compaction_request', {
          campaignId: c.id,
          initiatingTurnId: t.id,
          batchTurnIds: batchIds,
          priorMemoryId: c.memory?.valid ? c.memory.id : null,
          prompt: batch.prompt,
        });
        const parsed = memorySchema.parse(
          await this.generator.generate(
            t.settings,
            batch.prompt,
            memoryJsonSchema,
            ctl.signal,
            childTrace
          )
        );
        // The previous valid memory is preserved byte-for-byte; the model only supplies the new batch.
        const composed = composeMemory(c.memory, parsed.text, batchIds);
        const memory: Memory = {
          id: randomUUID(),
          text: composed.text,
          coveredTurnIds: composed.coveredTurnIds,
          valid: true,
          createdAt: new Date().toISOString(),
        };
        await traceEvent(childTrace, 'compaction_composed', {
          campaignId: c.id,
          initiatingTurnId: t.id,
          batchTurnIds: batchIds,
          priorMemoryId: c.memory?.valid ? c.memory.id : null,
          resultMemoryId: memory.id,
          priorBytes: composed.priorBytes,
          additionBytes: composed.additionBytes,
          resultBytes: composed.resultBytes,
        });
        await this.store.transaction(async (client) => {
          const { campaign } = await this.lockedOwned(t, client);
          await this.store.memory(campaign, memory, client);
          await this.store.save(campaign, client);
        });
        await traceEvent(childTrace, 'compaction_committed', {
          campaignId: c.id,
          resultMemoryId: memory.id,
          coveredTurns: memory.coveredTurnIds.length,
        });
        c = await this.store.campaign(c.id);
        history = await this.store.activeTurns(c.id);
        needs = olderHistoryBytes(c, history) > AUTO_COMPACTION_HISTORY_THRESHOLD_BYTES;
      }
      // Uncovered older turns remain in gameplay history until a summary is committed.
      if (!t.retryOfTurnId)
        await this.store.transaction(async (client) => {
          const { campaign, turn } = await this.lockedOwned(t, client);
          const h = await this.store.activeTurns(campaign.id, client);
          const rules = await this.store.retrieve(campaign, t.action, client, sceneText(campaign));
          turn.context = buildContext(
            campaign,
            h,
            t.action,
            rules,
            t.ruleContext
              ? this.rulePrompt(await new RuleStore(this.store).guard(t.ruleContext, client))
              : undefined,
            await this.compactHistory(campaign, h, client)
          );
          t.context = turn.context;
          await this.store.saveTurn(turn, client);
        });
      await withResponseRetries(
        async (attempt, feedback) => {
          if (trace) {
            trace.correctionAttempt = attempt;
            trace.runId ??= trace.executionId;
            trace.executionId = randomUUID();
          }
          await traceEvent(trace, 'execution_attempt', { attempt });
          const dice = new DiceService(this.store);
          const combat = new CombatPreparationService(this.store);
          let frozenDefinitions: GameplayToolDefinition[] | undefined;
          if (t.diceSessionId) {
            const saved = await this.store.pool.query(
              'SELECT * FROM dice_sessions WHERE id=$1 AND campaign_id=$2',
              [t.diceSessionId, t.campaignId]
            );
            const root = saved.rows[0];
            if (!root?.system_prompt)
              throw new Problem(409, 'dice_context', 'Frozen session metadata is missing');
            t.context!.systemPrompt = root.system_prompt;
            t.context!.frozenKnowledge = root.frozen_knowledge;
            t.context!.frozenSources = root.frozen_sources ?? undefined;
            t.context!.frozenHistory = root.frozen_history ?? undefined;
            frozenDefinitions = root.tool_definitions;
          }
          if (!this.generator.generateOwnedGameplay)
            throw new Problem(
              503,
              'gameplay_unavailable',
              'Owned gameplay is not available for this provider'
            );
          c = await this.store.campaign(t.campaignId);
          const rules = new RuleStore(this.store);
          const lookup = new RuleLookup();
          const sourceLookup = new CampaignSourceLookup(this.store);
          const registry = new GameplayTools({
            book: t.ruleContext?.kind === RuleSystemKind.Library,
            knowledge: t.context!.frozenKnowledge ?? freezeKnowledge(c, true),
            readCampaignSource: (tool, input, requestId) =>
              sourceLookup.read(t, tool, input, `repair:${attempt}:${requestId}`, ctl.signal),
            signal: ctl.signal,
            roll: (input) => dice.roll(t.diceSessionId!, t, input),
            read: async (tool, input, requestId) =>
              (
                await rules.read(
                  t,
                  tool,
                  input,
                  `repair:${attempt}:${requestId}`,
                  lookup,
                  ctl.signal
                )
              ).payload,
            assertActive: async () => {
              await this.store.transaction(async (client) => {
                await this.lockedOwned(t, client);
              });
            },
            prepareCombat: (input) => combat.prepare(t, input),
            ...(t.context!.frozenHistory
              ? { history: new HistoryReader(this.store, t.context!.frozenHistory) }
              : {}),
          });
          if (!t.diceSessionId) {
            c = await this.store.campaign(t.campaignId);
            history = await this.store.activeTurns(c.id);
            const characters = JSON.parse(t.context!.prompt).mandatory.characters as {
              id: string;
            }[];
            t.diceSessionId = await dice.createSession(
              t,
              gameplayDigest(c, history, t.ruleContext),
              [
                ...new Set([
                  ...characters.map((character) => character.id),
                  ...(t.context!.frozenKnowledge?.npcCharacters ?? []).map((npc) => npc.id),
                ]),
              ],
              {
                frozenSources: t.context!.frozenSources,
                frozenHistory: t.context!.frozenHistory,
                systemPrompt: t.context!.systemPrompt!,
                knowledge: t.context!.frozenKnowledge ?? freezeKnowledge(c, true),
                toolDefinitions: registry.definitions,
              }
            );
          }
          if (frozenDefinitions) {
            if (!isDeepStrictEqual(registry.definitions, frozenDefinitions))
              throw new Problem(
                409,
                'dice_context',
                'Frozen gameplay tool definitions changed; start a new action'
              );
            registry.call.definitions = frozenDefinitions;
          }
          const existing = await dice.records(t.diceSessionId);
          const specifications = existing.map(
            ({
              id: _id,
              sessionId: _sessionId,
              campaignId: _campaignId,
              createdAt: _createdAt,
              groups,
              ...input
            }) => ({
              ...input,
              groups: groups.map((group) => ({
                label: group.label,
                sides: group.sides,
                count: group.faces.length,
              })),
            })
          );
          // Preparation receipts belong to the logical session; retries reuse their identities.
          const preparations = (await combat.authorization(t.diceSessionId)).preparations.map(
            ({ preparationKey, payload }) => ({
              localKey: preparationKey,
              encounterId: payload.encounterId,
              participants: payload.participants.map(({ characterId, label }) => ({
                characterId,
                label,
              })),
              createOperations: payload.createOperations,
            })
          );
          const prompt =
            t.context!.prompt +
            (feedback ? `\nResponse correction: ${feedback}` : '') +
            (specifications.length
              ? '\nReplay the original requests in order with exactly these specifications before appending any dice: ' +
                JSON.stringify(specifications)
              : '') +
            (preparations.length
              ? '\nCombat preparations already recorded for this action; reuse these IDs and repeat combat_prepare only with identical arguments: ' +
                JSON.stringify(preparations)
              : '');
          const raw = await this.generator.generateOwnedGameplay(
            t.settings,
            prompt,
            gameplayResponseWireJsonSchema,
            t.context!.systemPrompt!,
            this.tracedTools(registry, trace),
            ctl.signal,
            trace
          );
          let response = raw as GameplayResponse;
          try {
            await validateWithFieldRepair(
              response,
              async (candidate) => {
                const parsed = gameplayResponseInputSchema.parse(candidate);
                await this.persistResponse(t, parsed, true);
                response = parsed;
              },
              this.generator,
              t.settings,
              ctl.signal,
              trace,
              async () =>
                this.store.transaction(async (client) => {
                  const { campaign } = await this.lockedOwned(t, client);
                  const sources = await new CampaignSourceLookup(this.store).records(
                    t.campaignId,
                    t.id,
                    client
                  );
                  const rules = await client.query(
                    'SELECT id,payload FROM turn_rule_reads WHERE turn_id=$1 ORDER BY created_at,id',
                    [t.id]
                  );
                  return {
                    sourceSpans: [
                      ...(t.context?.sourceSpans ?? []),
                      ...sources.flatMap((read) =>
                        read.payload.sourceSpan ? [read.payload.sourceSpan] : []
                      ),
                    ],
                    ruleReads: rules.rows,
                    characters: campaign.characters,
                    knowledge: campaign.knowledge,
                    state: campaign.state,
                    rolls: await new DiceService(this.store).records(t.diceSessionId!, client),
                    combat: await combat.authorization(t.diceSessionId!, client),
                  };
                })
            );
            await traceEvent(trace, 'validated_candidate', { response, editingPending: true });
          } catch (error) {
            await traceEvent(trace, 'candidate_rejected', { code: operationalProblem(error).code });
            throw error;
          }
        },
        async () => {
          await this.store.transaction(async (client) => {
            await this.lockedOwned(t, client);
            if (t.diceSessionId)
              await client.query(
                'UPDATE dice_attempts SET next_slot=0,requests=0 WHERE turn_id=$1',
                [t.id]
              );
          });
        },
        ctl.signal
      );
      await this.finishEditing(t, ctl.signal, trace);
    } catch (e) {
      await traceEvent(trace, 'execution_failed', {
        code: operationalProblem(heartbeatFailure ?? e).code,
        editingPending: t.editingPending ?? false,
      });
      reportProcessingFailure('turn_generation', heartbeatFailure ?? e, t.id);
      await this.store
        .transaction(async (client) => {
          await this.store.campaign(t.campaignId, client, true);
          const turn = await this.store.turn(t.campaignId, t.id, client, true);
          if (![TurnStatus.Pending, TurnStatus.Running].includes(turn.status as TurnStatus)) return;
          turn.status = ctl.signal.aborted ? TurnStatus.Cancelled : TurnStatus.Failed;
          turn.completedAt = new Date().toISOString();
          turn.error = operationalProblem(heartbeatFailure ?? e).message;
          await this.store.saveTurn(turn, client);
        })
        .catch((error) => reportProcessingFailure('turn_failure_persistence', error, t.id));
    } finally {
      clearInterval(heartbeat);
      this.aborts.delete(t.id);
    }
  }
  private tracedTools(registry: GameplayTools, trace?: PromptTraceContext) {
    const call: typeof registry.call = async (name, input, requestId) => {
      await traceEvent(trace, 'owned_tool_request', { name, input, requestId });
      try {
        const result = await registry.call(name, input, requestId);
        await traceEvent(trace, 'owned_tool_result', { name, requestId, result });
        return result;
      } catch (error) {
        await traceEvent(trace, 'owned_tool_rejected', {
          name,
          requestId,
          ...safeProcessingFailure(error),
        });
        throw error;
      }
    };
    call.definitions = registry.call.definitions;
    return call;
  }
  private async finishEditing(
    t: Turn,
    signal: AbortSignal,
    trace?: PromptTraceContext
  ): Promise<void> {
    const repository = new NarrativeCandidateRepository(this.store.pool);
    const candidate = await repository.load(t.id);
    if (!candidate || candidate.status === 'abandoned')
      throw conflict('No saved narrative is available for editing');
    const campaign = await this.store.campaign(t.campaignId);
    const savedResponse = gameplayResponseSchema.parse(candidate.rawResponse);
    const combatLinks =
      savedResponse.combatEffects.length > 0 || savedResponse.participantReferences.length > 0;
    const narrative =
      candidate.editedNarrative ??
      (await humanizeNarrative(this.generator, candidate.settings, candidate.rawNarrative, {
        signal,
        trace,
        // Dice placements and participant links both address paragraphs by number.
        preserveParagraphs:
          combatLinks ||
          savedResponse.rollInterpretations.some((entry) => entry.afterParagraph !== undefined),
        protectedNames: [
          ...campaign.characters.map((character) => character.name),
          ...savedResponse.operations.flatMap((op) =>
            op.op === 'create' ? [op.character.name] : []
          ),
        ],
      }));
    await this.store.transaction(async (client) => {
      await this.lockedOwned(t, client);
      await repository.complete(t.id, ownerId, candidate.candidateDigest, narrative, client);
    });
    await this.persistResponse(t, savedResponse, false, narrative);
    await traceEvent(trace, 'committed', { narrative, turnId: t.id });
    if (trace?.trace?.incomplete)
      await this.store.pool.query(
        `UPDATE turns SET document=jsonb_set(document,'{traceWarning}',to_jsonb($2::text)) WHERE id=$1 AND status=$3`,
        [
          t.id,
          'Local audit logging is incomplete; saved gameplay was not repeated.',
          TurnStatus.Completed,
        ]
      );
  }
  private async persistResponse(
    t: Turn,
    response: GameplayResponse,
    prepare = false,
    editedNarrative?: string
  ): Promise<void> {
    const dice = new DiceService(this.store);
    await this.store.transaction(async (client) => {
      const { campaign, turn } = await this.lockedOwned(t, client);
      const sessionId = t.diceSessionId!;
      const sourceReads = await new CampaignSourceLookup(this.store).records(
        t.campaignId,
        t.id,
        client
      );
      const ruleReads = await turnRuleReads(t.id, client);
      const sourceSpans = [
        ...(t.context?.sourceSpans ?? []),
        ...sourceReads.flatMap((read) =>
          read.payload.sourceSpan ? [sourceSpanSchema.parse(read.payload.sourceSpan)] : []
        ),
      ];
      Object.assign(
        response,
        bindResponseCitations(response, {
          campaignId: t.campaignId,
          turnId: t.id,
          ruleContext: t.ruleContext,
          sourceSpans,
          ruleReads,
        })
      );
      const records = await dice.records(sessionId, client);
      const attempt = await client.query('SELECT next_slot FROM dice_attempts WHERE turn_id=$1', [
        t.id,
      ]);
      if (attempt.rows[0]?.next_slot !== records.length)
        throw new Problem(
          409,
          'dice_replay',
          'Replay every original roll before completing the retry'
        );
      atResponseField(['rollInterpretations'], () => {
        validateRollInterpretations(
          response,
          records.map((record) => record.id)
        );
        validateRollPlacement({
          narrative: editedNarrative ?? response.narrative,
          rollInterpretations: response.rollInterpretations,
        });
      });
      turn.rollInterpretations = response.rollInterpretations;
      turn.rolls = records;
      if (t.ruleContext?.kind === RuleSystemKind.Library) {
        validateRuleCitations(response, ruleReads, t.campaignId, t.id, t.ruleContext);
        turn.ruleCitations = response.ruleCitations;
      } else if (response.ruleCitations.length)
        throw new Problem(
          502,
          'rules_citations_invalid',
          'No original-book citations are available without a library'
        );
      turn.sourceReads = sourceReads;
      const applied = applyResponse(campaign, response, t.id, {
        campaignId: campaign.id,
        turnId: t.id,
        sourceSpans,
        rolls: turn.rolls,
        ruleContext: t.ruleContext,
        ruleReads,
        combat: {
          authorization: await new CombatPreparationService(this.store).authorization(
            sessionId,
            client
          ),
          narrative: editedNarrative ?? response.narrative,
        },
      });
      if (prepare) {
        await new NarrativeCandidateRepository(this.store.pool).save(
          {
            turnId: t.id,
            campaignId: campaign.id,
            campaignRevision: campaign.revision,
            ruleContext: t.ruleContext ?? null,
            settings: t.settings,
            rawResponse: response,
            rawNarrative: response.narrative,
            owner: ownerId,
          },
          client
        );
        turn.editingPending = true;
        t.editingPending = true;
        turn.traceId = t.traceId;
        await this.store.saveTurn(turn, client);
        return;
      }
      applied.campaign.revision++;
      turn.narrative = editedNarrative ?? response.narrative;
      turn.editingPending = false;
      turn.operationExplanations = response.operationExplanations;
      turn.combatEffects = response.combatEffects;
      turn.participantReferences = response.participantReferences;
      turn.changes = applied.changes;
      turn.status = TurnStatus.Completed;
      turn.completedAt = new Date().toISOString();
      await client.query('INSERT INTO snapshots(turn_id,campaign_id,document) VALUES($1,$2,$3)', [
        t.id,
        campaign.id,
        applied.snapshot,
      ]);
      await this.store.save(applied.campaign, client);
      await this.store.saveTurn(turn, client);
    });
  }
  async cancel(campaignId: string, id: string): Promise<Turn> {
    const turn = await this.store.transaction(async (client) => {
      await this.store.campaign(campaignId, client, true);
      const t = await this.store.turn(campaignId, id, client, true);
      if (
        t.editingPending ||
        [TurnStatus.Pending, TurnStatus.Running].includes(t.status as TurnStatus)
      ) {
        t.status = TurnStatus.Cancelled;
        t.completedAt = new Date().toISOString();
        t.error = 'Cancelled by player';
        if (t.editingPending)
          await new NarrativeCandidateRepository(this.store.pool).abandon(id, client);
        t.editingPending = false;
        await this.store.saveTurn(t, client);
      }
      return t;
    });
    this.aborts.get(id)?.abort();
    return turn;
  }
  async undo(campaignId: string, _revision: number): Promise<Campaign> {
    return this.store.transaction(async (client) => {
      const c = await this.store.campaign(campaignId, client, true);
      await this.store.assertIdle(c.id, client);
      const turns = await this.store.activeTurns(c.id, client);
      const last = turns.at(-1);
      if (!last) throw conflict('No completed active turn to undo');
      const snapshot = await this.store.snapshot(last.id, client);
      // Journal changes made after this turn are never silently overwritten or left unsupported.
      assertNoCorrectionEvidence(c, last.id);
      assertNoLaterCorrection(c, snapshot.afterKnowledge ?? []);
      const restored = undoSnapshot(c, snapshot);
      reconcileBackfillUndo(
        restored,
        last.id,
        new Set((snapshot.afterKnowledge ?? []).map((record) => record.id))
      );
      last.undone = true;
      await this.store.saveTurn(last, client);
      // Summaries derived from the undone turn, and anything built on them, must not be selected again.
      await new HistoryStore(this.store).invalidateTurns(client, c.id, [last.id]);
      const rows = await client.query(
        'SELECT id,document FROM memories WHERE campaign_id=$1 ORDER BY created_at DESC',
        [c.id]
      );
      let chosen: Memory | null = null;
      for (const row of rows.rows) {
        const m = row.document as Memory;
        if (m.coveredTurnIds.includes(last.id)) {
          m.valid = false;
          await client.query('UPDATE memories SET document=$2 WHERE id=$1', [m.id, m]);
        }
        if (
          !chosen &&
          m.valid &&
          m.coveredTurnIds.every((id) => turns.some((t) => t.id === id && !t.undone))
        )
          chosen = m;
      }
      restored.memory = chosen;
      restored.revision++;
      await this.store.save(restored, client);
      return restored;
    });
  }
  /** Selective-history input for a new context; null keeps the full-memory (legacy) prompt. */
  private async compactHistory(campaign: Campaign, turns: Turn[], client: PoolClient) {
    const settings = historySettingsOf(campaign);
    if (!settings.enabled) return undefined;
    const history = new HistoryStore(this.store);
    const versions = await history.captureVersions(client, campaign.id, turns);
    const fragments = await history.list(campaign.id, client, true);
    const memories = settings.protectedMemoryIds.length
      ? await client.query(
          'SELECT document FROM memories WHERE campaign_id=$1 AND id=ANY($2::uuid[])',
          [campaign.id, settings.protectedMemoryIds]
        )
      : { rows: [] };
    return {
      fragments,
      turnVersions: versions.map(({ turnId, contentHash }) => ({ turnId, contentHash })),
      protectedMemories: memories.rows
        .map((row) => row.document as Memory)
        .filter((m) => m.valid)
        .map((m) => ({ id: m.id, text: m.text })),
    };
  }
  async manualMemory(
    id: string,
    input: { revision: number; text: string; coveredTurnIds: string[]; confirm: true }
  ): Promise<Campaign> {
    return this.store.edit(id, input.revision, async (c, client) => {
      await this.store.assertIdle(c.id, client);
      const turns = await this.store.activeTurns(c.id, client);
      const exact = turns.slice(0, input.coveredTurnIds.length).map((t) => t.id);
      if (
        !input.coveredTurnIds.length ||
        JSON.stringify(exact) !== JSON.stringify(input.coveredTurnIds)
      )
        throw new Problem(
          422,
          'memory_coverage',
          'Reviewed coverage must be an exact consecutive prefix of active completed turns'
        );
      await this.store.memory(
        c,
        {
          id: randomUUID(),
          text: input.text,
          coveredTurnIds: exact,
          valid: true,
          createdAt: new Date().toISOString(),
        },
        client
      );
    });
  }
}
const sceneText = (c: Campaign) => (typeof c.state.scene === 'string' ? c.state.scene : '');
async function turnRuleReads(turnId: string, client: PoolClient): Promise<RuleRead[]> {
  const rows = await client.query(
    'SELECT * FROM turn_rule_reads WHERE turn_id=$1 ORDER BY created_at,id',
    [turnId]
  );
  return rows.rows.map((row) => ({
    id: row.id,
    campaignId: row.campaign_id,
    turnId: row.turn_id,
    context: row.captured_context,
    tool: row.tool_name,
    transportRequestId: row.transport_request_id,
    argumentDigest: row.argument_digest,
    resultHash: row.result_hash,
    payload: row.payload,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}
