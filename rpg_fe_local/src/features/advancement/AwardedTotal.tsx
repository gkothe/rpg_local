import { useEffect } from 'react';
import { useResource } from '../../hooks/useResource';
import { ErrorNotice } from '../../components/Controls';
import { subscribeAdvancement } from './events';
import type { AdvancementSummary } from './types';
import { request } from '../../services/client';
async function loadSummary(path: string): Promise<AdvancementSummary> {
  const value = await request<AdvancementSummary>(path);
  if (
    !value ||
    !Array.isArray(value.players) ||
    !value.players.every(
      (p) =>
        p &&
        typeof p.characterId === 'string' &&
        Array.isArray(p.totals) &&
        p.totals.every(
          (t) =>
            t &&
            typeof t.total === 'number' &&
            Number.isFinite(t.total) &&
            typeof t.unitLabel === 'string' &&
            typeof t.systemLabel === 'string'
        )
    )
  )
    throw new Error('The server returned an incomplete advancement summary.');
  return value;
}
function formatTotal(t: { total: number; unitLabel: string }) {
  const formatted = t.total.toLocaleString(undefined, { maximumSignificantDigits: 21 });
  const unit = t.unitLabel.trim().toLowerCase();
  if (unit === 'experience points' || unit === 'experience' || unit === 'points' || unit === 'xp') {
    return `${formatted} ${t.total === 1 ? 'point' : 'points'}`;
  }
  return `${formatted} ${t.unitLabel}`;
}

export default function AwardedTotal({
  campaignId,
  characterId,
}: {
  campaignId: string;
  characterId: string;
}) {
  const summary = useResource<AdvancementSummary>(
    `/campaigns/${campaignId}/advancement/summary`,
    loadSummary
  );
  const reload = summary.reload;
  useEffect(() => subscribeAdvancement(campaignId, () => void reload()), [campaignId, reload]);
  const player = summary.data?.players.find((p) => p.characterId === characterId);
  return (
    <div className="awarded-total">
      <output aria-label="Exp Awarded so far">
        Exp Awarded so far:{' '}
        {summary.loading
          ? 'Loading…'
          : summary.error
            ? 'Unavailable'
            : player
              ? player.totals.length
                ? player.totals.map(formatTotal).join('; ')
                : '0 points'
              : 'Player record unavailable'}
      </output>
      <small className="muted">
        Update your sheet manually; spending and sheet edits do not change this total.
      </small>
      <ErrorNotice message={summary.error} />
      {summary.error && <button onClick={() => void summary.reload()}>Retry awards load</button>}
    </div>
  );
}
