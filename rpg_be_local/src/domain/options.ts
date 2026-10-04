export enum TurnStatus {
  Pending = 'pending',
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
  Cancelled = 'cancelled',
  Interrupted = 'interrupted',
}
export const ARCHIVE_TURN_STATUSES = [
  TurnStatus.Completed,
  TurnStatus.Failed,
  TurnStatus.Cancelled,
  TurnStatus.Interrupted,
] as const;
export enum CharacterType {
  Player = 'player',
  Npc = 'npc',
}
export enum SourceStatus {
  Draft = 'draft',
  Confirmed = 'confirmed',
}
export enum SourceKind {
  Text = 'text',
  File = 'file',
  Pdf = 'pdf',
  GoogleDoc = 'google-doc',
}
export enum SourcePurpose {
  Campaign = 'campaign',
  Character = 'character',
  Reference = 'reference',
}
export const SOURCE_PURPOSE_OPTIONS = [
  { id: SourcePurpose.Campaign, label: 'Campaign preparation', default: false },
  { id: SourcePurpose.Character, label: 'Character sheet', default: false },
  { id: SourcePurpose.Reference, label: 'Reference material', default: true },
] as const;
export const OPERATION_KIND = { Create: 'create', Set: 'set', State: 'state' } as const;
export const CHARACTER_FIELD = {
  Name: 'name',
  Attributes: 'attributes',
  Inventory: 'inventory',
  Description: 'description',
} as const;
export const CHARACTER_MUTABLE_FIELDS = [
  CHARACTER_FIELD.Name,
  CHARACTER_FIELD.Attributes,
  CHARACTER_FIELD.Inventory,
  CHARACTER_FIELD.Description,
] as const;
export const OCR_LANGUAGE_CODES = ['eng', 'por', 'eng+por'] as const;
export const TRANSCRIPTION_LANGUAGE_CODES = ['auto', 'en', 'pt'] as const;
export const CONTEXT_BUDGET_LIMITS = {
  gameplay: { min: 2000, max: 16000, default: 16000 },
  compaction: { min: 2000, max: 8000, default: 8000 },
  memory: { min: 200, max: 2000, default: 2000 },
} as const;
export const CONTEXT_DEFAULTS = {
  gameplay: CONTEXT_BUDGET_LIMITS.gameplay.default,
  compaction: CONTEXT_BUDGET_LIMITS.compaction.default,
  memory: CONTEXT_BUDGET_LIMITS.memory.default,
} as const;
export const TURN_STATUS_OPTIONS = [
  { id: TurnStatus.Pending, label: 'Preparing', active: true, terminal: false, completed: false },
  { id: TurnStatus.Running, label: 'GM thinking', active: true, terminal: false, completed: false },
  { id: TurnStatus.Completed, label: 'Completed', active: false, terminal: true, completed: true },
  { id: TurnStatus.Failed, label: 'Failed', active: false, terminal: true, completed: false },
  { id: TurnStatus.Cancelled, label: 'Cancelled', active: false, terminal: true, completed: false },
  {
    id: TurnStatus.Interrupted,
    label: 'Interrupted',
    active: false,
    terminal: true,
    completed: false,
  },
] as const;
export const CHARACTER_TYPE_OPTIONS = [
  { id: CharacterType.Player, label: 'Player', default: true },
  { id: CharacterType.Npc, label: 'NPC', default: false },
] as const;
export const SOURCE_STATUS_OPTIONS = [
  { id: SourceStatus.Draft, label: 'Review extraction', confirmed: false },
  { id: SourceStatus.Confirmed, label: 'Confirmed', confirmed: true },
] as const;
export const SOURCE_KIND_OPTIONS = [
  { id: SourceKind.Text, label: 'Pasted text' },
  { id: SourceKind.File, label: 'Text / Markdown file' },
  { id: SourceKind.Pdf, label: 'PDF' },
  { id: SourceKind.GoogleDoc, label: 'Public Google Doc' },
] as const;
export const OCR_LANGUAGE_OPTIONS = [
  { id: OCR_LANGUAGE_CODES[0], label: 'English', default: true },
  { id: OCR_LANGUAGE_CODES[1], label: 'Portuguese', default: false },
  { id: OCR_LANGUAGE_CODES[2], label: 'English + Portuguese', default: false },
] as const;
export const TRANSCRIPTION_LANGUAGE_OPTIONS = [
  { id: TRANSCRIPTION_LANGUAGE_CODES[0], label: 'Detect language', default: true },
  { id: TRANSCRIPTION_LANGUAGE_CODES[1], label: 'English', default: false },
  { id: TRANSCRIPTION_LANGUAGE_CODES[2], label: 'Portuguese', default: false },
] as const;

export {
  KNOWLEDGE_KIND_OPTIONS,
  KNOWLEDGE_ORIGIN_OPTIONS,
  KNOWLEDGE_CERTAINTY_OPTIONS,
  KNOWLEDGE_STATUS_OPTIONS,
} from './knowledge.js';
