import { KnowledgeVisibility, type CampaignKnowledge } from './knowledge.js';
import type { Campaign, Turn } from './types.js';
/** Player views intentionally omit hidden historical provenance after a partial reveal. */
export function publicKnowledge(records: readonly CampaignKnowledge[]): CampaignKnowledge[] {
  return records
    .filter((r) => r.visibility !== KnowledgeVisibility.GmOnly)
    .map((r) => {
      const record = structuredClone(r);
      record.attributions = record.attributions
        .filter((a) => a.visibility !== KnowledgeVisibility.GmOnly)
        .map(({ revealReason: _privateReason, ...a }) => a);
      record.characterNames = Object.fromEntries(
        record.characterIds.map((id) => [id, record.characterNames[id]!])
      );
      if (record.introductionVisibility === KnowledgeVisibility.GmOnly) {
        record.evidence = [];
        record.createdTurnId = null;
      }
      if (!record.holderId) delete record.holderName;
      delete record.introductionVisibility;
      return record;
    });
}
export function publicCampaign(campaign: Campaign): Campaign {
  return {
    id: campaign.id,
    name: campaign.name,
    description: campaign.description,
    instructions: campaign.instructions,
    revision: campaign.revision,
    notes: campaign.notes,
    notesRevision: campaign.notesRevision,
    characters: structuredClone(campaign.characters),
    sources: structuredClone(campaign.sources),
    settings: structuredClone(campaign.settings),
    pinnedSourceIds: [...campaign.pinnedSourceIds],
    pinnedSourceSections: structuredClone(campaign.pinnedSourceSections),
    budgets: { ...campaign.budgets },
    state: structuredClone(campaign.state),
    memory: structuredClone(campaign.memory),
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
    knowledge: publicKnowledge(campaign.knowledge ?? []),
    ...(campaign.historyRecall ? { historyRecall: structuredClone(campaign.historyRecall) } : {}),
    ...(campaign.ruleSystemId !== undefined ? { ruleSystemId: campaign.ruleSystemId } : {}),
    ...(campaign.ruleReference ? { ruleReference: structuredClone(campaign.ruleReference) } : {}),
    ...(campaign.ruleResolution
      ? { ruleResolution: structuredClone(campaign.ruleResolution) }
      : {}),
  };
}
/** Frozen context, source receipts and validated-but-uncommitted candidates are diagnostics only. */
export function publicTurn(turn: Turn): Turn {
  const safe = structuredClone(turn);
  // Pick a public DTO explicitly: new internal fields cannot leak through object spreading.
  return {
    id: safe.id,
    campaignId: safe.campaignId,
    requestId: safe.requestId,
    status: safe.status,
    action: safe.action,
    narrative: safe.narrative,
    changes: safe.changes,
    error: safe.error,
    undone: safe.undone,
    settings: safe.settings,
    context: null,
    createdAt: safe.createdAt,
    completedAt: safe.completedAt,
    ...(safe.diceSessionId ? { diceSessionId: safe.diceSessionId } : {}),
    ...(safe.retryOfTurnId ? { retryOfTurnId: safe.retryOfTurnId } : {}),
    ...(safe.rolls ? { rolls: safe.rolls } : {}),
    ...(safe.rollInterpretations ? { rollInterpretations: safe.rollInterpretations } : {}),
    ...(safe.ruleCitations ? { ruleCitations: safe.ruleCitations } : {}),
    ...(safe.operationExplanations
      ? {
          operationExplanations: safe.operationExplanations.filter(
            (e) => e.visibility !== KnowledgeVisibility.GmOnly
          ),
        }
      : {}),
    // Committed v6 links reference public sheets; preparation receipts never reach players.
    ...(safe.combatEffects ? { combatEffects: safe.combatEffects } : {}),
    ...(safe.participantReferences ? { participantReferences: safe.participantReferences } : {}),
    ...(safe.editingPending ? { editingPending: true } : {}),
    ...(safe.editingResume ? { editingResume: safe.editingResume } : {}),
    ...(safe.traceWarning ? { traceWarning: safe.traceWarning } : {}),
    ...(safe.diceRetry ? { diceRetry: safe.diceRetry } : {}),
  };
}
