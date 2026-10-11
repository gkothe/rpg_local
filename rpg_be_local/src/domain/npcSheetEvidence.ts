import { occurrences } from './citationBinding.js';
import { citationPages } from './ruleCitationValidation.js';
import { ruleCitationSchema, type RuleContext } from './rules.js';
import { npcSheetRequirementsSchema, type NpcSheetRequirements } from './npcSheet.js';
import { Problem } from '../errors.js';

export type NpcSheetRead = {
  id: string;
  campaignId: string;
  ownerId: string;
  characterId?: string;
  context: RuleContext;
  tool: string;
  payload: Record<string, unknown>;
};
export function bindNpcSheetEvidence(
  raw: NpcSheetRequirements,
  reads: readonly NpcSheetRead[],
  scope: { campaignId: string; ownerId: string; characterId?: string; systemId: string }
): NpcSheetRequirements {
  const requirements = npcSheetRequirementsSchema.parse(structuredClone(raw));
  requirements.citations = requirements.citations.map((c) => {
    const r = reads.find((read) => read.id === c.receiptId);
    if (
      !r ||
      r.campaignId !== scope.campaignId ||
      r.ownerId !== scope.ownerId ||
      r.characterId !== scope.characterId ||
      r.context.systemId !== scope.systemId ||
      r.tool !== 'rules_get' ||
      r.payload.view !== 'text' ||
      r.payload.structural ||
      r.payload.path !== c.path ||
      r.payload.source !== c.source ||
      r.context.systemId !== c.systemId ||
      r.context.revision !== c.revision ||
      r.context.contentHash !== c.contentHash ||
      typeof r.payload.text !== 'string' ||
      typeof r.payload.start !== 'number'
    )
      throw new Problem(
        422,
        'npc_sheet_evidence',
        'Sheet rules must cite original text owned by this request'
      );
    const starts = occurrences(r.payload.text, c.quote, r.payload.start);
    if (starts.length !== 1)
      throw new Problem(
        422,
        'npc_sheet_evidence',
        'Sheet rule quote must occur exactly once in its original receipt'
      );
    const start = starts[0]!,
      end = start + c.quote.length;
    return ruleCitationSchema.parse({ ...c, start, end, ...citationPages(r.payload, start, end) });
  });
  return requirements;
}
