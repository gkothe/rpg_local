import type { JournalJobView } from '../../services/types';
import { ErrorNotice } from '../../components/Controls';

export function JournalJobPanel({
  job,
  error,
  busy,
  pollFailure,
  onCancel,
  onRetry,
  onRefresh,
}: {
  job: JournalJobView | null;
  error: string;
  busy: boolean;
  pollFailure: boolean;
  onCancel: () => void;
  onRetry: () => void;
  onRefresh: () => void;
}) {
  const progress = job?.progress;
  return (
    <div className="journal-job stack">
      {/* Polite live region: status changes are announced without moving focus or editing drafts. */}
      <p role="status" aria-live="polite">
        {job
          ? `${job.statusLabel}${
              progress
                ? `: ${progress.processedPairs} of ${progress.eligiblePairs} conversations checked`
                : ''
            }`
          : ''}
        {job && progress && progress.created !== null && progress.skipped !== null
          ? ` · ${progress.created} found · ${progress.skipped} skipped`
          : ''}
      </p>
      <ErrorNotice message={error || job?.error?.message || ''} />
      <div className="journal-job-actions">
        {job?.active && (
          <button disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        )}
        {job && (job.status === 'failed' || job.status === 'interrupted') && (
          <button disabled={busy} onClick={onRetry}>
            Retry task
          </button>
        )}
        {pollFailure && <button onClick={onRefresh}>Check status again</button>}
      </div>
    </div>
  );
}
