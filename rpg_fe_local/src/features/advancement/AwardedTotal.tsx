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
    <div className="stack">
      <label>Awarded through this feature</label>
      <output aria-label="Awarded through this feature">
        {summary.loading
          ? 'Loading…'
          : summary.error
            ? 'Unavailable'
            : player
              ? player.totals.length
                ? player.totals
                    .map(
                      (t) =>
                        `${t.total.toLocaleString(undefined, { maximumSignificantDigits: 21 })} ${t.unitLabel} (${t.systemLabel})`
                    )
                    .join('; ')
                : '0 — no awards recorded'
              : 'Player record unavailable'}
      </output>
      <small className="muted">
        Historical awards only. Update your sheet manually; spending and sheet edits do not change
        this total.
      </small>
      <ErrorNotice message={summary.error} />
      {summary.error && <button onClick={() => void summary.reload()}>Retry awards load</button>}
    </div>
  );
}
