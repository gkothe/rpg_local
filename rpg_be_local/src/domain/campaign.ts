import { randomUUID } from 'node:crypto';
import type { Campaign, ProviderSettings } from './types.js';
import { CONTEXT_DEFAULTS } from './options.js';
export const emptySettings: ProviderSettings = { provider: '', model: '', effort: null };
export function newCampaign(input: {
  name: string;
  description?: string;
  instructions?: string;
  settings?: ProviderSettings;
  systemId?: string | null;
}): Campaign {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    ruleSystemId: input.systemId ?? null,
    name: input.name,
    description: input.description ?? '',
    instructions: input.instructions ?? '',
    revision: 0,
    notes: '',
    notesRevision: 0,
    characters: [],
    knowledge: [],
    sources: [],
    settings: input.settings ?? { ...emptySettings },
    pinnedSourceIds: [],
    pinnedSourceSections: [],
    budgets: { ...CONTEXT_DEFAULTS },
    state: {},
    memory: null,
    createdAt: now,
    updatedAt: now,
  };
}
