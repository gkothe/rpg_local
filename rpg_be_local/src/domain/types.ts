import type {
  CHARACTER_MUTABLE_FIELDS,
  CharacterType as CharacterTypeEnum,
  SourceKind as SourceKindEnum,
  SourceStatus as SourceStatusEnum,
  TurnStatus as TurnStatusEnum,
  OPERATION_KIND,
} from './options.js';
import type {
  ARCHIVE_FORMAT_ID,
  ARCHIVE_FORMAT_VERSION,
  GM_RESPONSE_SCHEMA_VERSION,
} from './versions.js';

export type JsonObject = Record<string, unknown>;
export type ProviderSettings = { provider: string; model: string; effort: string | null };
export type CharacterType = `${CharacterTypeEnum}`;
export type SourceKind = `${SourceKindEnum}`;
export type SourceStatus = `${SourceStatusEnum}`;
export type TurnStatus = `${TurnStatusEnum}`;
export type OperationKind = (typeof OPERATION_KIND)[keyof typeof OPERATION_KIND];
export type CharacterMutableField = (typeof CHARACTER_MUTABLE_FIELDS)[number];
export type Character = {
  id: string;
  name: string;
  type: CharacterType;
  attributes: JsonObject;
  inventory: JsonObject;
  description: JsonObject;
  notes: string;
  revision: number;
};
export type Source = {
  id: string;
  name: string;
  kind: SourceKind;
  text: string;
  status: SourceStatus;
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
      op: typeof OPERATION_KIND.Create;
      character: {
        name: string;
        type: CharacterType;
        attributes: JsonObject;
        inventory: JsonObject;
        description: JsonObject;
      };
    }
  | {
      op: typeof OPERATION_KIND.Set;
      characterId: string;
      field: CharacterMutableField;
      expected: unknown;
      value: unknown;
    }
  | { op: typeof OPERATION_KIND.State; expected: JsonObject; value: JsonObject };
export type GMResponse = {
  version: typeof GM_RESPONSE_SCHEMA_VERSION;
  narrative: string;
  operations: Operation[];
};
export type Snapshot = {
  turnId: string;
  beforeCharacters: Character[];
  afterCharacters: Character[];
  beforeState: JsonObject;
  afterState: JsonObject;
  beforeMemory: Memory | null;
  changedFields?: {
    characterId: string;
    fields: CharacterMutableField[];
  }[];
};
export type Archive = {
  format: typeof ARCHIVE_FORMAT_ID;
  version: typeof ARCHIVE_FORMAT_VERSION;
  campaign: Campaign;
  turns: Turn[];
  snapshots: Snapshot[];
  memories: Memory[];
};
