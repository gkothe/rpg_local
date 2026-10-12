import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorNotice } from '../../components/Controls';
import { ApiError, errorMessage, json, request } from '../../services/client';
import type { CampaignDetail, GmIndexStatus, Settings } from '../../services/types';
import { useMemoryRebuild } from './useMemoryRebuild';

export default function GmIndex({
  campaign,
  options,
  active,
  onChanged,
}: {
  campaign: CampaignDetail;
  options: Settings | null;
  active: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [status, setStatus] = useState<GmIndexStatus | null>(null);
  const [error, setError] = useState('');
  const [disabling, setDisabling] = useState(false);
  const scope = useRef(campaign.id),
    guard = useRef(false),
    pendingDisable = useRef<string | null>(null);
  const advertised = options?.gmIndex;
  const refresh = useCallback(async () => {
    const owner = campaign.id;
    try {
      const next = await request<GmIndexStatus>(`/campaigns/${owner}/gm-index`);
      if (scope.current === owner) {
        setStatus(next);
        setError('');
      }
    } catch (failure) {
      if (scope.current === owner) setError(errorMessage(failure));
    }
  }, [campaign.id]);
  const rebuild = useMemoryRebuild(
    campaign.id,
    active && !!advertised,
    async () => {
      await refresh();
      await onChanged();
    },
    advertised?.purposeId ?? ''
  );
  useEffect(() => {
    scope.current = campaign.id;
    setStatus(null);
    setError('');
    pendingDisable.current = null;
    guard.current = false;
    setDisabling(false);
    return () => {
      scope.current = '';
    };
  }, [campaign.id]);
  useEffect(() => {
    if (active && advertised) void refresh();
  }, [active, advertised, refresh, campaign.revision, rebuild.job?.status]);
  const disable = async () => {
    if (guard.current) return;
    guard.current = true;
    setDisabling(true);
    const owner = campaign.id;
    pendingDisable.current ??= crypto.randomUUID();
    try {
      await request(
        `/campaigns/${owner}/gm-index/disable`,
        json('POST', { requestId: pendingDisable.current, expectedEnabled: true })
      );
      if (scope.current !== owner) return;
      pendingDisable.current = null;
      await refresh();
      await onChanged();
    } catch (failure) {
      if (scope.current === owner) {
        setError(errorMessage(failure));
        if (failure instanceof ApiError && failure.status >= 400 && failure.status < 500)
          pendingDisable.current = null;
      }
    } finally {
      if (scope.current === owner) {
        guard.current = false;
        setDisabling(false);
      }
    }
  };
  if (!advertised) return null;
  const job = rebuild.job;
  const reviewing = !!job?.candidate && !job.decision;
  const blocked =
    !active ||
    !status?.canPrepare ||
    rebuild.busy ||
    !rebuild.loaded ||
    !!job?.active ||
    reviewing ||
    !!rebuild.foreign?.active;
  const preview = job?.gmIndex?.preview;
  return (
    <section className="panel stack" aria-label="GM working index">
      <h3>GM working index</h3>
      <p>
        Persistent notes help the GM remember commitments, clues and possible developments.
        Preparation reads the saved campaign and history using your provider allowance. Review the
        player-known coverage before applying it. Private GM plans stay hidden.
      </p>
      <p role="status" aria-live="polite">
        {status?.enabled ? 'Enabled: notes update before each turn finishes.' : 'Not enabled.'}
        {status?.refreshRequired
          ? ' Changed information will be refreshed during the next turn.'
          : ''}
      </p>
      <div className="journal-job-actions">
        {advertised.modes.map(
          (mode, index) =>
            (index === 0 || status?.prepared) && (
              <button key={mode.id} disabled={blocked} onClick={() => void rebuild.start(mode.id)}>
                {mode.label}
              </button>
            )
        )}
        {status?.enabled && (
          <button
            disabled={disabling || rebuild.busy || !!job?.active}
            onClick={() => void disable()}
          >
            Disable GM index
          </button>
        )}
      </div>
      {status?.blockedReason && <small className="muted">{status.blockedReason}</small>}
      {rebuild.foreign?.active && (
        <p>Another preparation is running. Manage it in its corresponding memory/history panel.</p>
      )}
      {job && (
        <p role="status">
          {job.gmIndex?.progress ? (
            <>
              {job.statusLabel}: {job.gmIndex.progress.label}. {job.gmIndex.progress.completedSteps}{' '}
              of {job.gmIndex.progress.totalSteps} steps completed;{' '}
              {job.gmIndex.progress.retrievalCalls} retrieval calls (
              {job.gmIndex.progress.emptySearches} empty searches). Last server activity:{' '}
              {new Date(job.gmIndex.progress.lastActivityAt).toLocaleTimeString()}.
            </>
          ) : (
            <>
              {job.statusLabel}: {job.processedTurns} of {job.totalTurns} captured batches checked.
            </>
          )}
        </p>
      )}
      <ErrorNotice message={error || rebuild.error || job?.safeError || ''} />
      {preview && reviewing && (
        <div className="stack" aria-label="Review player-known index coverage">
          <p>
            Checked {preview.coverage.turns} turns, {preview.coverage.sourceSections} source
            sections and {preview.coverage.knowledge} knowledge records.
          </p>
          {!!preview.coverage.unconfirmedSources && (
            <p>
              {preview.coverage.unconfirmedSources} attached source(s) are unconfirmed and were not
              used.
            </p>
          )}
          {!!preview.coverage.emptyConfirmedSources && (
            <p role="alert">
              {preview.coverage.emptyConfirmedSources} confirmed source(s) have no text. Add their
              text and rebuild to include them.
            </p>
          )}
          <details>
            <summary>Player-known topics ({preview.topics.length})</summary>
            {preview.topics.map((topic, index) => (
              <div key={index}>
                <strong>{topic.title}</strong>
                <p>{topic.text}</p>
              </div>
            ))}
          </details>
          <p>
            Applying uses this reviewed preparation. The first application enables notes for this
            campaign. Rebuilding an existing index keeps its activation setting.
          </p>
        </div>
      )}
      {job && (
        <div className="journal-job-actions">
          {job.allowedActions.map((action) => {
            const label = options?.memoryRebuild?.actionOptions.find(
              (option) => option.id === action
            )?.label;
            if (!label) return null;
            return (
              <button
                key={action}
                disabled={rebuild.busy}
                onClick={() =>
                  void rebuild.command(
                    action,
                    action === 'apply' ? { proposalDigest: job.candidate!.proposalDigest } : {}
                  )
                }
              >
                {label}
              </button>
            );
          })}
          {rebuild.pollFailure && (
            <button onClick={() => void rebuild.refresh()}>Check status again</button>
          )}
        </div>
      )}
    </section>
  );
}
