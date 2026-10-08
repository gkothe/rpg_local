import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, errorMessage, json, request } from '../../services/client';
import type { JournalJobView, Settings } from '../../services/types';
import { ErrorNotice } from '../../components/Controls';
import { JournalJobPanel } from './JournalJob';
import { useJournalJob } from './useJournalJob';

type Decision = { decision: 'accepted' | 'dismissed' };

/** Flag a recorded fact, review the GM's evidence-based finding, then accept or dismiss it. */
export default function JournalCorrection({
  campaignId,
  entryId,
  options,
  onChanged,
}: {
  campaignId: string;
  entryId: string;
  options: Settings | null;
  /** Called after a confirmed canonical change so lists and campaign data refresh. */
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false),
    [explanation, setExplanation] = useState(''),
    [decisionError, setDecisionError] = useState(''),
    [done, setDone] = useState(''),
    [deciding, setDeciding] = useState(false),
    guard = useRef(false),
    pendingDecision = useRef<{ key: string; requestId: string } | null>(null);
  const max = options?.journal?.limits.explanationMaxChars;
  const task = useJournalJob(campaignId);
  const { job } = task;
  const finding = job?.finding ?? null;

  async function decide(kind: 'accept' | 'dismiss', current: JournalJobView) {
    if (guard.current) return;
    guard.current = true;
    setDeciding(true);
    const body = kind === 'accept' ? { proposalDigest: current.finding?.proposalDigest } : {};
    const key = JSON.stringify([kind, current.id, body]);
    // An uncertain answer keeps its identity so a lost acknowledgement replays the saved decision.
    const requestId =
      pendingDecision.current?.key === key
        ? pendingDecision.current.requestId
        : crypto.randomUUID();
    pendingDecision.current = { key, requestId };
    try {
      const result = await request<Decision>(
        `/campaigns/${campaignId}/journal/jobs/${current.id}/${kind}`,
        json('POST', { requestId, ...body })
      );
      pendingDecision.current = null;
      setDecisionError('');
      setDone(result.decision === 'accepted' ? 'Correction accepted.' : 'Finding dismissed.');
      if (result.decision === 'accepted') onChanged();
      task.attach({ ...current, decision: result.decision });
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500)
        pendingDecision.current = null;
      setDecisionError(errorMessage(e));
    } finally {
      guard.current = false;
      setDeciding(false);
    }
  }

  const settled = job && !job.active;
  return (
    <div className="journal-correction stack">
      <button aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Close mistake report' : 'Flag a mistake'}
      </button>
      {open && (
        <div className="stack">
          <label className="field">
            <span>What looks wrong?</span>
            <textarea
              rows={3}
              maxLength={max}
              value={explanation}
              disabled={!!job?.active}
              onChange={(e) => setExplanation(e.target.value)}
            />
          </label>
          <small className="muted">
            The GM checks your saved conversations with the selected campaign provider/model, which
            uses your provider allowance. Nothing changes until you accept a proposed correction.
          </small>
          {(!job || settled) && !done && (
            <button
              disabled={task.busy || !explanation.trim()}
              onClick={() =>
                void task.start(`/campaigns/${campaignId}/journal/entries/${entryId}/checks`, {
                  explanation: explanation.trim(),
                })
              }
            >
              Check this fact
            </button>
          )}
          <JournalJobPanel
            job={job}
            error={task.error}
            busy={task.busy}
            pollFailure={task.pollFailure}
            onCancel={() => void task.cancel()}
            onRetry={() => void task.retry()}
            onRefresh={() => void task.refresh()}
          />
          {settled && job.status === 'completed' && finding && !job.decision && (
            <section className="journal-finding stack" aria-label="Finding">
              <h5>{finding.outcomeLabel}</h5>
              <p className="prose">{finding.reason}</p>
              {finding.changes.map((c) => (
                <div key={c.field} className="journal-change">
                  <strong>{c.label}</strong>
                  <p>
                    <span className="muted">Now:</span> {c.before ?? 'none'}
                  </p>
                  <p>
                    <span className="muted">Proposed:</span> {c.after ?? 'none'}
                  </p>
                </div>
              ))}
              {finding.evidence.map((e, i) => (
                <blockquote key={i} className="journal-quote">
                  {e.quote}{' '}
                  <Link to={`/campaigns/${campaignId}?tab=play&turn=${e.turnId}`}>
                    Open conversation
                  </Link>
                </blockquote>
              ))}
              {finding.outcome === 'proposed' && (
                <>
                  <small className="muted">
                    After accepting, undoing a turn this correction relies on is blocked. The saved
                    conversation text is never rewritten.
                  </small>
                  <button disabled={deciding} onClick={() => void decide('accept', job)}>
                    Accept correction
                  </button>
                </>
              )}
              <button disabled={deciding} onClick={() => void decide('dismiss', job)}>
                {finding.outcome === 'proposed' ? 'Dismiss' : 'Close'}
              </button>
            </section>
          )}
          <ErrorNotice message={decisionError} />
          {done && <p role="status">{done}</p>}
        </div>
      )}
    </div>
  );
}
