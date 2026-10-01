export enum TurnStatus {
  Pending = 'pending',
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
  Cancelled = 'cancelled',
  Interrupted = 'interrupted',
}
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
export const CONTEXT_DEFAULTS = { gameplay: 16000, compaction: 8000, memory: 2000 } as const;
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
  { id: 'eng', label: 'English', default: true },
  { id: 'por', label: 'Portuguese', default: false },
  { id: 'eng+por', label: 'English + Portuguese', default: false },
] as const;
export const TRANSCRIPTION_LANGUAGE_OPTIONS = [
  { id: 'auto', label: 'Detect language', default: true },
  { id: 'en', label: 'English', default: false },
  { id: 'pt', label: 'Portuguese', default: false },
] as const;
