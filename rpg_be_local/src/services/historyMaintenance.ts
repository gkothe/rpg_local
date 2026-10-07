import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { conflict } from '../errors.js';
import {
  chapterPrompt,
  derivationDigest,
  historyOverviewJsonSchema,
  historyOverviewSchema,
  historySectionJsonSchema,
  historySectionSchema,
  overviewPrompt,
  sectionPrompt,
} from '../domain/historyGeneration.js';
import {
  HISTORY_DEFAULTS,
  HistoryFragmentKind,
  correctionDigestOf,
  historySettingsOf,
  turnVersionOf,
  compareFragments,
  type HistoryFragment,
  type HistoryFragmentPayload,
  type SourceLocator,
} from '../domain/historyRecall.js';
import { RECENT_GAMEPLAY_TURN_COUNT, summaryTurns } from '../domain/context.js';
import { correctionGuidance } from '../domain/journalCompatibility.js';
import { publicKnowledge } from '../domain/playerProjection.js';
import { safeTraceFailure, traceEvent, type PromptTraceContext } from '../providers/promptLog.js';
import type { Generator } from '../providers/service.js';
import type { Campaign, ProviderSettings, Turn } from '../domain/types.js';
import type { Store } from '../store.js';
import { HistoryStore, finalizedTurns } from './historyStore.js';

export type MaintenanceResult = { sections: number; chapters: number; overview: boolean };
export type MaintenanceInput = {
  campaignId: string;
  settings: ProviderSettings;
  signal: AbortSignal;
  trace?: PromptTraceContext;
  /** Runs `fn` in a short transaction that first proves the calling turn still owns the campaign. */
  commit: <T>(fn: (client: PoolClient) => Promise<T>) => Promise<T>;
};

/**
 * Keeps an active history index current inside a user's turn: complete blocks of newly older turns
 * become sections, full groups of sections become chapters, and the overview is regenerated once.
 * Every generated step is committed separately, outside provider calls, only while the turn owner
 * and the captured source versions are unchanged. A failure keeps the previous index untouched.
 */
export class HistoryMaintenance {
  private history: HistoryStore;
  constructor(
    private store: Store,
    private generator: Generator
  ) {
    this.history = new HistoryStore(store);
  }

  private async generate(
    input: MaintenanceInput,
    prompt: string,
    schema: unknown
  ): Promise<unknown> {
    const root = input.trace;
    const child: PromptTraceContext | undefined = root && {
      ...root,
      executionId: randomUUID(),
      purpose: 'history_maintenance',
    };
    await traceEvent(child, 'request', { prompt, schema });
    try {
      const result = await this.generator.generate(
        input.settings,
        prompt,
        schema,
        input.signal,
        child
      );
      await traceEvent(child, 'result', { result });
      return result;
    } catch (error) {
      await traceEvent(child, 'failure', safeTraceFailure(error));
      throw error;
    }
  }

  async run(input: MaintenanceInput): Promise<MaintenanceResult> {
    const none: MaintenanceResult = { sections: 0, chapters: 0, overview: false };
    const campaign = await this.store.campaign(input.campaignId);
    const settings = historySettingsOf(campaign);
    // Without a current overview the whole index needs the explicit Prepare/Review/Activate flow.
    if (!settings.enabled || !settings.activeOverviewId) return none;
    const turns = await this.store.activeTurns(input.campaignId);
    const fragments = await this.history.list(input.campaignId, undefined, true);
    if (!fragments.some((f) => f.id === settings.activeOverviewId)) return none;
    const older = finalizedTurns(turns).slice(
      0,
      Math.max(0, finalizedTurns(turns).length - RECENT_GAMEPLAY_TURN_COUNT)
    );
    const covered = new Set(
      fragments
        .filter((f) => f.kind === HistoryFragmentKind.Section)
        .flatMap((f) => f.sources.map((s) => s.turnId))
    );
    const first = older.findIndex((t) => !covered.has(t.id));
    if (first < 0) return none;
    // Only a contiguous uncovered tail is maintained; any other shape needs a fresh Prepare.
    if (older.slice(first).some((t) => covered.has(t.id))) return none;
    const corrections = correctionGuidance(campaign);
    const correctionDigest = correctionDigestOf(corrections);
    const result = { ...none };
    const published: HistoryFragment[] = [];
    let previous = [...fragments]
      .filter((f) => f.kind === HistoryFragmentKind.Section)
      .sort(compareFragments)
      .at(-1);

    // Sections: whole blocks only; a trailing partial block stays in the prompt until it fills.
    const block = HISTORY_DEFAULTS.turnsPerSection;
    for (let start = first; start + block <= older.length; start += block) {
      const source = older.slice(start, start + block);
      const versions = source.map(turnVersionOf);
      const out = historySectionSchema.parse(
        await this.generate(
          input,
          sectionPrompt(summaryTurns(source), previous?.text ?? '', corrections),
          historySectionJsonSchema
        )
      );
      const sources: SourceLocator[] = versions.map(({ turnId, contentHash }) => ({
        turnId,
        contentHash,
      }));
      const [section] = await input.commit(async (client) => {
        await this.assertSourcesUnchanged(client, input.campaignId, sources);
        return this.history.publish(client, input.campaignId, [
          this.payload(
            HistoryFragmentKind.Section,
            out,
            sources,
            [],
            campaign,
            source,
            corrections,
            correctionDigest
          ),
        ]);
      });
      published.push(section!);
      previous = section!;
      result.sections++;
    }
    if (!published.length) return none;

    // Chapters: every complete, not yet chaptered group of sections, regenerated from the originals.
    const perChapter = HISTORY_DEFAULTS.sectionsPerChapter;
    const live = (await this.history.list(input.campaignId, undefined, true)).sort(
      compareFragments
    );
    const chaptered = new Set(
      live.filter((f) => f.kind === HistoryFragmentKind.Chapter).flatMap((f) => f.parentIds)
    );
    const open = live.filter((f) => f.kind === HistoryFragmentKind.Section && !chaptered.has(f.id));
    const byId = new Map(turns.map((t) => [t.id, t] as const));
    for (let i = 0; i + perChapter <= open.length; i += perChapter) {
      const group = open.slice(i, i + perChapter);
      const sources = group.flatMap((f) => f.sources);
      const source = sources.map((s) => byId.get(s.turnId));
      if (source.some((t) => !t)) continue;
      const out = historySectionSchema.parse(
        await this.generate(
          input,
          chapterPrompt(
            summaryTurns(source as Turn[]),
            group.map((f) => f.title),
            corrections
          ),
          historySectionJsonSchema
        )
      );
      const [chapter] = await input.commit(async (client) => {
        await this.assertSourcesUnchanged(client, input.campaignId, sources);
        return this.history.publish(client, input.campaignId, [
          this.payload(
            HistoryFragmentKind.Chapter,
            out,
            sources,
            group.map((f) => f.id),
            campaign,
            source as Turn[],
            corrections,
            correctionDigest
          ),
        ]);
      });
      published.push(chapter!);
      result.chapters++;
    }

    // Overview: one regeneration from the current chapters and any section not yet in a chapter.
    const current = (await this.history.list(input.campaignId, undefined, true)).sort(
      compareFragments
    );
    // Story order, not publication order: a chapter is published after the sections it covers.
    const position = new Map(turns.map((t, i) => [t.id, i] as const));
    const order = (f: HistoryFragment) => position.get(f.sources[0]?.turnId ?? '') ?? 0;
    const chapters = current.filter((f) => f.kind === HistoryFragmentKind.Chapter);
    const inChapter = new Set(chapters.flatMap((f) => f.parentIds));
    const basis = [
      ...chapters,
      ...current.filter((f) => f.kind === HistoryFragmentKind.Section && !inChapter.has(f.id)),
    ].sort((a, b) => order(a) - order(b) || compareFragments(a, b));
    const pinned = new Set(settings.protectedKnowledgeIds);
    const overview = historyOverviewSchema.parse(
      await this.generate(
        input,
        overviewPrompt(
          basis.map(({ title, text }) => ({ title, text })),
          publicKnowledge(campaign.knowledge ?? [])
            .filter((k) => pinned.has(k.id))
            .map(({ title, text }) => ({ title, text })),
          corrections
        ),
        historyOverviewJsonSchema
      )
    );
    const allSources = current
      .filter((f) => f.kind === HistoryFragmentKind.Section)
      .flatMap((f) => f.sources);
    await input.commit(async (client) => {
      await this.assertSourcesUnchanged(client, input.campaignId, allSources);
      const locked = await this.store.campaign(input.campaignId, client, true);
      const [created] = await this.history.publish(client, input.campaignId, [
        {
          kind: HistoryFragmentKind.Overview,
          title: 'Story so far',
          text: overview.text,
          sources: allSources,
          parentIds: basis.map((f) => f.id),
          derivationDigest: derivationDigest(HistoryFragmentKind.Overview, allSources, corrections),
          correctionDigest,
          links: [],
        },
      ]);
      const next = structuredClone(historySettingsOf(locked));
      if (next.activeOverviewId)
        await client.query(
          "UPDATE history_fragments SET selection_status='stale' WHERE campaign_id=$1 AND id=$2",
          [input.campaignId, next.activeOverviewId]
        );
      next.activeOverviewId = created!.id;
      locked.historyRecall = next;
      locked.revision++;
      await this.store.save(locked, client);
    });
    result.overview = true;
    return result;
  }

  private payload(
    kind: HistoryFragmentKind,
    out: { title: string; text: string },
    sources: SourceLocator[],
    parentIds: string[],
    campaign: Campaign,
    turns: readonly Turn[],
    corrections: ReturnType<typeof correctionGuidance>,
    correctionDigest: string
  ): HistoryFragmentPayload {
    const text = turns
      .map((t) => `${t.action} ${t.narrative ?? ''}`)
      .join(' ')
      .toLocaleLowerCase();
    return {
      kind,
      title: out.title,
      text: out.text,
      sources,
      parentIds,
      derivationDigest: derivationDigest(kind, sources, corrections),
      correctionDigest,
      links: publicKnowledge(campaign.knowledge ?? [])
        .filter((k) => k.title && text.includes(k.title.toLocaleLowerCase()))
        .map((k) => k.id),
    };
  }

  /** The captured conversations must still be the delivered ones when the summary is committed. */
  private async assertSourcesUnchanged(
    client: PoolClient,
    campaignId: string,
    sources: readonly SourceLocator[]
  ) {
    const live = new Map(
      (
        await this.history.captureVersions(
          client,
          campaignId,
          await this.store.activeTurns(campaignId, client)
        )
      ).map((v) => [v.turnId, v.contentHash] as const)
    );
    if (sources.some((s) => live.get(s.turnId) !== s.contentHash))
      throw conflict('The story changed while history was being summarized; try the action again');
  }
}
