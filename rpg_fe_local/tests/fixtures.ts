import type { CampaignDetail, Provider, Settings, Turn } from '../src/services/types';
export const options: Settings = {
  turnStatusOptions: [
    { id: 'pending', label: 'Pending', active: true, terminal: false, completed: false },
    { id: 'running', label: 'Running', active: true, terminal: false, completed: false },
    { id: 'completed', label: 'Completed', active: false, terminal: true, completed: true },
    { id: 'cancelled', label: 'Cancelled', active: false, terminal: true, completed: false },
  ],
  sourceStatusOptions: [
    { id: 'draft', label: 'Draft', confirmed: false },
    { id: 'confirmed', label: 'Confirmed', confirmed: true },
  ],
  characterTypeOptions: [
    { id: 'player', label: 'Player', default: true },
    { id: 'npc', label: 'NPC', default: false },
  ],
  ocrLanguageOptions: [{ id: 'eng', label: 'English', default: true }],
  transcriptionLanguageOptions: [{ id: 'auto', label: 'Automatic', default: true }],
  defaults: {
    characterType: 'player',
    ocrLanguage: 'eng',
    transcriptionLanguage: 'auto',
    budgets: { compaction: 32768 },
  },
  audio: { available: false, reason: 'Synthetic tests use no microphone', maxSeconds: 60 },
  lan: { enabled: false },
  limits: { uploadBytes: 20 * 1024 * 1024 },
};
export const providers: Provider[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    available: true,
    supported: true,
    reason: null,
    version: 'test fixture',
    models: [
      { id: 'fixture-model', label: 'Fixture model', efforts: ['low', 'high'], inputTokens: 16000 },
    ],
    catalogProvenance: 'Synthetic test fixture',
  },
];
export function fixtureCampaign(): CampaignDetail {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'The Northern Road',
    description: 'Synthetic campaign for interface tests',
    instructions: 'Keep scenes concise.',
    revision: 1,
    notes: '',
    notesRevision: 1,
    characters: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Marta',
        type: 'npc',
        attributes: { health: 12 },
        inventory: { key: 'silver' },
        description: { appearance: 'A road warden' },
        notes: '',
        revision: 1,
      },
    ],
    sources: [],
    settings: { provider: 'claude', model: 'fixture-model', effort: 'low' },
    pinnedSourceIds: [],
    budgets: { compaction: 32768 },
    state: {},
    memory: null,
    createdAt: '2026-09-30T12:00:00Z',
    updatedAt: '2026-09-30T12:00:00Z',
    turns: [],
  };
}
export function fixtureTurn(): Turn {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    campaignId: fixtureCampaign().id,
    requestId: '44444444-4444-4444-8444-444444444444',
    status: 'completed',
    action: 'Open the door',
    narrative: 'Marta steps aside. The door opens onto a quiet courtyard.',
    changes: ['Marta: health changed from 12 to 5.'],
    error: null,
    undone: false,
    settings: fixtureCampaign().settings,
    context: { estimatedTokens: 1200, ceiling: 16000 },
    createdAt: '2026-09-30T12:01:00Z',
    completedAt: '2026-09-30T12:01:01Z',
  };
}
