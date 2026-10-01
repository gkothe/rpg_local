export interface ProviderSettings {
  provider: string;
  model: string;
  effort: string | null;
}
export interface Provider {
  id: string;
  name: string;
  available: boolean;
  supported: boolean;
  reason: string | null;
  version: string | null;
  models: { id: string; label: string; efforts: string[]; inputTokens: number }[];
  catalogProvenance: string;
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
export interface Campaign {
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
export interface Settings {
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
    budgets: { gameplay: number; compaction: number; memory: number };
  };
  audio: { available: boolean; reason: string | null; maxSeconds: number };
  lan: { enabled: boolean };
  limits: { uploadBytes: number };
}
