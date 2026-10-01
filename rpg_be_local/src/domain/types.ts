export type JsonObject = Record<string, unknown>;
export type ProviderSettings = { provider: string; model: string; effort: string | null };
export type Character = {
  id: string;
  name: string;
  type: 'player' | 'npc';
  attributes: JsonObject;
  inventory: JsonObject;
  description: JsonObject;
  notes: string;
  revision: number;
};
export type Source = {
  id: string;
  name: string;
  kind: 'text' | 'file' | 'pdf' | 'google-doc';
  text: string;
  status: 'draft' | 'confirmed';
  version: number;
  pages: JsonObject[];
  warnings: string[];
  originalAvailable?: boolean;
};
export type Memory = {
  id: string;
  text: string;
  coveredTurnIds: string[];
  valid: boolean;
  createdAt: string;
};
export type Campaign = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  revision: number;
  notes: string;
  notesRevision: number;
  characters: Character[];
  sources: Source[];
  settings: ProviderSettings;
  pinnedFacts: string[];
  pinnedSourceIds: string[];
  pinnedSourceSections?: { sourceId: string; version: number; index: number }[];
  budgets: { gameplay: number; compaction: number; memory: number };
  state: JsonObject;
  memory: Memory | null;
  createdAt: string;
  updatedAt: string;
};
export type TurnStatus =
  'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type Turn = {
  id: string;
  campaignId: string;
  requestId: string;
  status: TurnStatus;
  action: string;
  narrative: string | null;
  changes: string[];
  error: string | null;
  undone: boolean;
  settings: ProviderSettings;
  context: ContextManifest | null;
  createdAt: string;
  completedAt: string | null;
};
export type ContextManifest = {
  revision: number;
  prompt: string;
  estimatedTokens: number;
  estimator: string;
  sourceVersions: { id: string; version: number }[];
  historyIds: string[];
  memoryId: string | null;
};
export type Operation =
  | {
      op: 'create';
      character: {
        name: string;
        type: 'player' | 'npc';
        attributes: JsonObject;
        inventory: JsonObject;
        description: JsonObject;
      };
    }
  | {
      op: 'set';
      characterId: string;
      field: 'name' | 'attributes' | 'inventory' | 'description';
      expected: unknown;
      value: unknown;
    }
  | { op: 'state'; expected: JsonObject; value: JsonObject };
export type GMResponse = { version: 1; narrative: string; operations: Operation[] };
export type Snapshot = {
  turnId: string;
  beforeCharacters: Character[];
  afterCharacters: Character[];
  beforeState: JsonObject;
  afterState: JsonObject;
  beforeMemory: Memory | null;
  changedFields?: {
    characterId: string;
    fields: ('name' | 'attributes' | 'inventory' | 'description')[];
  }[];
};
export type Archive = {
  format: 'local-rpg';
  version: 1;
  campaign: Campaign;
  turns: Turn[];
  snapshots: Snapshot[];
  memories: Memory[];
};
