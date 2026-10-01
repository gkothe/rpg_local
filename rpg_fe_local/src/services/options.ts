import type { Settings, Turn, Source } from './types';
export const isActive = (turn: Turn, settings: Settings | null) =>
  !!settings?.turnStatusOptions.find((o) => o.id === turn.status)?.active;
export const isCompleted = (turn: Turn, settings: Settings | null) =>
  !!settings?.turnStatusOptions.find((o) => o.id === turn.status)?.completed;
export const isConfirmed = (source: Source, settings: Settings | null) =>
  !!settings?.sourceStatusOptions.find((o) => o.id === source.status)?.confirmed;
export const providerValid = (
  providers: import('./types').Provider[],
  settings: import('./types').ProviderSettings
) => {
  const p = providers.find((p) => p.id === settings.provider);
  const m = p?.models.find((m) => m.id === settings.model);
  return !!(
    p?.available &&
    p.supported &&
    p.dice?.supported !== false &&
    m &&
    m.dice?.supported !== false &&
    (settings.effort === null || m.efforts.includes(settings.effort))
  );
};
