import type { CampaignKnowledge, SourceSpan } from './knowledge.js';
import type { JournalLedger } from './journalLedger.js';
import type {
  FrozenCampaignSources,
  SourceSelectionDiagnostics,
  CampaignSourceRead,
} from './campaignSourceRecall.js';
import type { OperationExplanation } from './operationExplanations.js';
import type { CombatEffect, ParticipantReference } from './combat.js';
import type { FrozenKnowledge } from './knowledgeRecall.js';
import type {
  CHARACTER_MUTABLE_FIELDS,
  CharacterType as CharacterTypeEnum,
  SourceKind as SourceKindEnum,
  SourceStatus as SourceStatusEnum,
  SourcePurpose as SourcePurposeEnum,
  TurnStatus as TurnStatusEnum,
  OPERATION_KIND,
} from './options.js';
import type { ARCHIVE_FORMAT_ID } from '../services/library.js';
import type {
  CombatPreparationArchive,
  CombatPreparedCharacterArchive,
} from '../services/combatArchive.js';
import type {
  FrozenHistory,
  HistoryFragmentArchive,
  HistorySettings,
  HistoryVersionArchive,
} from './historyRecall.js';
import type { DiceRecord, DiceSession } from './dice.js';
import type { PlacedRollInterpretation } from './diceResponse.js';
import type { RuleContext, RuleReference, RuleRead, RuleCitation } from './rules.js';

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
  purpose?: `${SourcePurposeEnum}`;
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
  continuity?: import('./continuity.js').Continuity;
  advancementPolicy?: { manual: true };
  /** Optional selective-history settings; absent means disabled (full memory in prompts). */
  historyRecall?: HistorySettings;
  knowledge?: CampaignKnowledge[];
  /** Private audit ledger of Journal backfills and accepted corrections; never in player DTOs. */
  journal?: JournalLedger;
  ruleSystemId?: string | null;
  ruleReference?: RuleReference;
  ruleResolution?: { status: 'unresolved'; reference: RuleReference };
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
  pinnedSourceIds: string[];
  pinnedSourceSections?: { sourceId: string; version: number; index: number }[];
  budgets: { compaction: number };
  state: JsonObject;
  memory: Memory | null;
  createdAt: string;
  updatedAt: string;
};
export type Turn = {
  combatEffects?: CombatEffect[];
  participantReferences?: ParticipantReference[];
  sourceReads?: CampaignSourceRead[];
  operationExplanations?: OperationExplanation[];
  editingPending?: boolean;
  editingResume?: { available: boolean; reason: string | null };
  traceId?: string;
  traceWarning?: string;
  ruleContext?: RuleContext;
  ruleReads?: RuleRead[];
  ruleCitations?: RuleCitation[];
  diceSessionId?: string;
  retryOfTurnId?: string;
  rolls?: DiceRecord[];
  rollInterpretations?: PlacedRollInterpretation[];
  diceRetry?: { available: boolean; reason: string | null };
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
  frozenContinuity?: import('./continuity.js').FrozenContinuity;
  diceSessionId?: string;
  systemPrompt?: string;
  frozenSources?: FrozenCampaignSources;
  sourceSelection?: SourceSelectionDiagnostics;
  frozenKnowledge?: FrozenKnowledge;
  frozenHistory?: FrozenHistory;
  sourceSpans?: SourceSpan[];
  ruleContext?: RuleContext;
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
export type Snapshot = {
  beforeContinuity?: import('./continuity.js').NpcProfile[];
  afterContinuity?: import('./continuity.js').NpcProfile[];
  beforeKnowledge?: CampaignKnowledge[];
  afterKnowledge?: CampaignKnowledge[];
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
  npcPreparations?: import('../services/npcPreparationArchive.js').NpcPreparationArchive[];
  advancementReviews?: import('../services/advancementArchive.js').AdvancementArchive;
  format: typeof ARCHIVE_FORMAT_ID;
  campaign: Campaign;
  turns: Turn[];
  snapshots: Snapshot[];
  memories: Memory[];
  diceSessions: DiceSession[];
  diceRecords: DiceRecord[];
  combatPreparations: CombatPreparationArchive[];
  combatPreparedCharacters: CombatPreparedCharacterArchive[];
  /** Optional: older archives carry no selective history and import with it disabled. */
  historyTurnVersions?: HistoryVersionArchive[];
  historyFragments?: HistoryFragmentArchive[];
};
