export interface ProviderSettings {
  provider: string;
  model: string;
  effort: string | null;
}
export interface RuleContext {
  systemId: string;
  systemKey: string;
  systemName: string;
  kind: string;
  revision: number;
  contentHash: string;
}
export type RuleReference = Pick<RuleContext, 'systemKey' | 'systemName' | 'kind' | 'contentHash'>;
export interface RuleSystemOption extends RuleContext {
  isDefault: boolean;
  selectable: boolean;
}
export interface RuleRead {
  id: string;
  campaignId: string;
  turnId: string;
  context: RuleContext;
  tool: string;
  payload: Record<string, unknown>;
  createdAt: string;
}
export interface RuleCitation {
  receiptId: string;
  path: string;
  quote: string;
  source: string;
  systemId: string;
  revision: number;
  contentHash: string;
  precision: string;
  pdfPages: number[];
  printedPages: string[];
}
export interface SheetFieldHint {
  path: string[];
  widget: string;
  label?: string;
  max?: number;
  maxPath?: string[];
  modifierPath?: string[];
  order?: number;
}
export interface SheetLayout {
  fields: SheetFieldHint[];
}
export interface SheetWidgetOption {
  id: string;
  label: string;
  description: string;
  params: {
    max?: { min: number; max: number; required: boolean };
    maxPath?: boolean;
    modifierPath?: boolean;
  };
}
export interface SheetLayoutOptions {
  widgets: SheetWidgetOption[];
  limits: { fields: number; bytes: number; labelChars: number; pathSegments: number };
}
export interface RuleSystemMetadata extends RuleContext {
  sheetLayout?: SheetLayout;
  sheetLayoutUpdatedAt?: string | null;
  sheetLayoutOptions?: SheetLayoutOptions;
  booksAllowed: boolean;
  limits: {
    instructionsBytes: number;
    importFiles: number;
    importFileBytes: number;
    importBytes: number;
    backupBytes: number;
  };
  instructions: string;
  sources: { slug: string; title: string; pageCount: number; pdfHash: string | null }[];
  populatedColumns: string[];
}
export interface RulePageProvenance {
  precision: string;
  pdfPages: (number | null)[];
  printedPages: (string | null)[];
}
export interface RuleLookupResult {
  revision: number;
  contentHash: string;
  receipt: string;
  complete: boolean;
  omitted: boolean;
  cursor: string | null;
  path?: string;
  source?: string;
  text?: string;
  start?: number;
  end?: number;
  pages?: RulePageProvenance | null;
  entries?: {
    path?: string;
    name?: string;
    source?: string;
    snippet?: string;
    locator?: string | null;
    derived?: boolean;
    pages?: RulePageProvenance;
  }[];
}
export interface RuleImportPreview {
  previewId: string;
  expiresAt: string;
  source: { slug: string; title: string };
  nodeCount: number;
  replacing: boolean;
  warnings: string[];
  coverage: { description: string; omissions: string[] };
  columns: string[];
}
export interface Provider {
  compatibilityWarning?: string | null;
  rules?: { supported: boolean; reason: string | null };
  id: string;
  name: string;
  available: boolean;
  supported: boolean;
  reason: string | null;
  version: string | null;
  models: {
    id: string;
    label: string;
    efforts: string[];
    inputTokens: number;
    dice?: { supported: boolean; reason: string | null };
    rules?: {
      supported: boolean;
      reason: string | null;
      efforts?: string[];
    };
  }[];
  catalogProvenance: string;
  dice?: { supported: boolean; reason: string | null };
}
export interface Character {
  id: string;
  name: string;
  type: string;
  attributes: Record<string, unknown>;
  inventory: Record<string, unknown>;
  description: Record<string, unknown>;
  notes: string;
  revision: number;
}
export interface Source {
  purpose?: string;
  id: string;
  name: string;
  kind: string;
  text: string;
  status: string;
  version: number;
  pages: object[];
  warnings: string[];
  originalAvailable?: boolean;
}
export interface Turn {
  ruleContext?: RuleContext;
  ruleReads?: RuleRead[];
  ruleCitations?: RuleCitation[];
  diceSessionId?: string;
  retryOfTurnId?: string;
  traceWarning?: string;
  editingPending?: boolean;
  editingResume?: { available: boolean; reason: string | null };
  operationExplanations?: {
    operationIndex: number;
    reason: string;
    basis: string;
    visibility: string;
    rollIds: string[];
    evidence: unknown[];
  }[];
  diceRetry?: { available: boolean; reason: string | null };
  rolls?: {
    id: string;
    sessionId: string;
    campaignId: string;
    slot: number;
    reason: string;
    declaration: string;
    actorId?: string;
    targetId?: string;
    rerollOf?: { rollId: string; reason: string };
    groups: { label: string; sides: number; faces: number[] }[];
    createdAt: string;
  }[];
  rollInterpretations?: {
    rollId: string;
    afterParagraph?: number;
    explanation: string;
    corrections?: { explanation: string }[];
  }[];
  id: string;
  campaignId: string;
  requestId: string;
  status: string;
  action: string;
  narrative: string | null;
  changes: string[];
  error: string | null;
  undone: boolean;
  settings: ProviderSettings;
  context: Record<string, unknown> | null;
  createdAt: string;
  completedAt: string | null;
}
export interface KnowledgeAttribution {
  origin: string;
  evidence: Record<string, unknown>[];
  turnId: string | null;
  at: string;
}
export interface CampaignKnowledge {
  id: string;
  kind: string;
  title: string;
  text: string;
  origin: string;
  certainty: string;
  status: string;
  characterIds: string[];
  characterNames: Record<string, string>;
  holderId?: string | null;
  holderName?: string;
  evidence: Record<string, unknown>[];
  createdTurnId: string | null;
  updatedTurnId: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
  attributions: KnowledgeAttribution[];
}
export interface Campaign {
  knowledge?: CampaignKnowledge[];
  ruleSystemId?: string | null;
  ruleReference?: RuleReference;
  ruleResolution?: { status: string; reference: RuleReference };
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
  state: Record<string, unknown>;
  memory: {
    id: string;
    text: string;
    coveredTurnIds: string[];
    valid: boolean;
    createdAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}
export interface LanStatus {
  enabled: boolean;
  desktop: boolean;
  paired: boolean;
  expiresAt: string | null;
  connectUrls: string[];
  microphoneRequiresHttps: boolean;
}
export interface SourceSection {
  id: string;
  index: number;
  text: string;
  start: number;
  end: number;
  page: number | null;
  version: number;
  pinned: boolean;
}
export interface CampaignDetail extends Campaign {
  turns: Turn[];
}
export interface Template {
  id: string;
  name: string;
  setup: object;
  createdAt: string;
}
export interface CharacterTemplate {
  id: string;
  name: string;
  character: Record<string, unknown>;
  createdAt: string;
}
export interface JournalConnection {
  id: string;
  title: string;
  group: string;
}
export interface JournalEvidenceRef {
  id: string;
  kind: 'turn' | 'campaign_source' | 'book';
  label: string;
  turnId?: string;
  available: boolean;
}
export interface JournalEntry {
  id: string;
  title: string;
  kind: string;
  group: string;
  status: string;
  statusLabel: string;
  certainty: string;
  certaintyLabel: string;
  overview: string;
  excerpt: boolean;
  text?: string;
  updatedAt: string;
  connections: JournalConnection[];
  evidence?: JournalEvidenceRef[];
  history?: {
    at: string;
    kind: string;
    origin: string;
    turnId: string | null;
    summary: string;
    reason?: string;
    changes?: { field: string; label: string; before: string | null; after: string | null }[];
  }[];
}
export interface JournalPage {
  entries: JournalEntry[];
  groups: { id: string; label: string; count: number }[];
  total: number;
  nextCursor: string | null;
}
export interface JournalFindingView {
  outcome: string;
  outcomeLabel: string;
  reason: string;
  knowledgeId: string;
  proposalDigest: string | null;
  changes: { field: string; label: string; before: string | null; after: string | null }[];
  evidence: { turnId: string; field: string; quote: string }[];
}
export interface JournalJobView {
  id: string;
  jobId?: string;
  kind: string;
  status: string;
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
  decision: 'accepted' | 'dismissed' | null;
  createdAt: string;
  updatedAt: string;
}
export type JournalEvidenceDetail =
  | { kind: 'turn'; label: string; turnId: string; available: boolean }
  | { kind: 'campaign_source' | 'book'; label: string; quote: string; available: true };
export interface MemoryRebuildJobView {
  id: string;
  campaignId: string;
  purpose?: string;
  status: string;
  statusLabel: string;
  active: boolean;
  processedTurns: number;
  totalTurns: number;
  createdAt: string;
  updatedAt: string;
  errorCode: string | null;
  safeError: string | null;
  allowedActions: string[];
  baseline: { id: string; text: string; coveredTurnIds: string[]; valid: boolean } | null;
  candidate: { text: string; coveredTurnIds: string[]; proposalDigest: string } | null;
  compact?: { sections: number; chapters: number } | null;
  decision: { action: string; requestId: string; memoryId: string | null } | null;
}
export interface MemoryRebuildPage {
  jobs: MemoryRebuildJobView[];
  current: MemoryRebuildJobView | null;
  nextCursor: string | null;
}
export interface MemoryRebuildApplyResult {
  campaign: CampaignDetail;
  job: MemoryRebuildJobView;
}
export interface HistoryDiagnostics {
  targetBytes: number;
  suppliedBytes: number;
  mandatoryBytes: number;
  overflowBytes: number;
  included: { id: string; reason: string }[];
  omitted: { count: number; reasonCounts: Record<string, number> };
}
export interface HistoryStatus {
  enabled: boolean;
  activeOverviewId: string | null;
  protectedKnowledgeIds: string[];
  protectedSectionIds: string[];
  protectedMemoryIds: string[];
  coveredTurns: number;
  totalTurns: number;
  searchableSections: number;
  pendingRefresh: boolean;
  unavailableProtectedIds: string[];
  diagnostics: HistoryDiagnostics;
}
export interface HistoryItem {
  id: string;
  title: string;
  kind: string;
  sourceTurnIds: string[];
  startAt: string | null;
  endAt: string | null;
  excerpt: string;
  protected: boolean;
  available: boolean;
}
export interface HistoryPage {
  items: HistoryItem[];
  nextCursor: string | null;
  status: HistoryStatus;
}
export interface HistoryDetail {
  item: { id: string; title: string; kind: string; text: string; protected: boolean };
  originals: { turnId: string; player: string; gm: string; createdAt: string }[];
  nextCursor: string | null;
  correctionGuidance: { instruction: string; items: unknown[] };
}
export interface Settings {
  history?: {
    kindOptions: { id: string; label: string }[];
    reasonOptions: { id: string; label: string }[];
    limits: { pageSizeDefault: number; originalsPageSize: number; queryMaxChars: number };
  } | null;
  memoryRebuild?: {
    actionOptions: { id: string; label: string }[];
    purposeOptions?: { id: string; label: string }[];
  };
  journal?: {
    limits: { queryMaxChars: number; pageSizeDefault: number; explanationMaxChars: number };
  };
  sourcePurposeOptions?: { id: string; label: string; default: boolean }[];
  knowledgeKindOptions?: { id: string; label: string }[];
  knowledgeOriginOptions?: { id: string; label: string }[];
  knowledgeCertaintyOptions?: { id: string; label: string }[];
  knowledgeStatusOptions?: { id: string; label: string }[];
  turnStatusOptions: {
    id: string;
    label: string;
    active: boolean;
    terminal: boolean;
    completed: boolean;
  }[];
  sourceStatusOptions: { id: string; label: string; confirmed: boolean }[];
  characterTypeOptions: { id: string; label: string; default: boolean }[];
  ocrLanguageOptions: { id: string; label: string; default: boolean }[];
  transcriptionLanguageOptions: { id: string; label: string; default: boolean }[];
  defaults: {
    characterType: string;
    ocrLanguage: string;
    transcriptionLanguage: string;
    budgets: { compaction: number };
  };
  audio: { available: boolean; reason: string | null; maxSeconds: number };
  lan: { enabled: boolean };
  limits: { uploadBytes: number };
  dice?: { enabled: boolean; limits: Record<string, number> };
}
