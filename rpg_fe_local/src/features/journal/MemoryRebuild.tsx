import type { MemoryRebuildJobView, Settings } from '../../services/types';
import { ErrorNotice } from '../../components/Controls';
import { MemoryText } from './MemoryText';
import { useMemoryRebuild } from './useMemoryRebuild';

/** Rebuild controls: the draft is only reviewed here; Apply is the single action that changes memory. */
export default function MemoryRebuild({
  campaignId,
  options,
  active = true,
  onApplied,
}: {
  campaignId: string;
  options: Settings | null;
  active?: boolean;
  onApplied?: () => Promise<void> | void;
}) {
  const { job, foreign, error, busy, loaded, pollFailure, start, command, refresh } =
    useMemoryRebuild(campaignId, active, onApplied);
  const label = (id: string) =>
    options?.memoryRebuild?.actionOptions.find((o) => o.id === id)?.label;
  // Controls come from the backend's list for this status; unknown actions are not rendered.
  const apply = (j: MemoryRebuildJobView) => () =>
    command('apply', { proposalDigest: j.candidate!.proposalDigest });
  const handlers = (j: MemoryRebuildJobView): Record<string, () => unknown> => ({
    cancel: () => command('cancel'),
    resume: () => command('resume'),
    discard: () => command('discard'),
    ...(j.candidate ? { apply: apply(j) } : {}),
  });
  const finished = !job || !job.active;
  const reviewing = !!job?.candidate && !job.decision;
  return (
    <div className="stack" aria-label="Rebuild campaign memory">
      <button
        disabled={busy || !loaded || !finished || reviewing || !active || !!foreign?.active}
        onClick={() => void start()}
      >
        Rebuild memory
      </button>
      <small className="muted">
        Rebuilds the summary from every saved turn using your provider allowance. The result is a
        draft you review first; nothing changes until you apply it.
      </small>
      {foreign?.active && (
        <small className="muted">
          A compact history task is running. Manage it under History recall below.
        </small>
      )}
      {/* Polite live region: progress is announced without moving focus. */}
      <p role="status" aria-live="polite">
        {job
          ? `${job.statusLabel}${
              job.active || job.status === 'failed' || job.status === 'interrupted'
                ? `: ${job.processedTurns} of ${job.totalTurns} turns summarized`
                : ''
            }`
          : ''}
      </p>
      <ErrorNotice message={error || job?.safeError || ''} />
      {job && (
        <div className="journal-job-actions">
          {job.allowedActions.map((id) => {
            const handler = handlers(job)[id];
            return handler ? (
              <button key={id} disabled={busy} onClick={() => void handler()}>
                {label(id) ?? id}
              </button>
            ) : null;
          })}
          {pollFailure && <button onClick={() => void refresh()}>Check status again</button>}
        </div>
      )}
      {job?.candidate && (
        <div className="stack">
          <h4>Memory when the rebuild started</h4>
          <MemoryText text={job.baseline?.text || 'No memory checkpoint then.'} />
          <h4>Proposed memory</h4>
          <small className="muted">Covers {job.candidate.coveredTurnIds.length} turns.</small>
          <MemoryText text={job.candidate.text} />
        </div>
      )}
    </div>
  );
}
