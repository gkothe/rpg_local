import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, errorMessage, json, request } from '../../services/client';
import type { JournalJobView } from '../../services/types';

/** Delay between sequential status reads; the next one is scheduled only after the last answers. */
const POLL_INTERVAL_MS = 1000;

const jobPath = (campaignId: string, jobId: string) =>
  `/campaigns/${campaignId}/journal/jobs/${jobId}`;

/** A response proves the request failed only when the server answered with a client error. */
const definiteFailure = (e: unknown) => e instanceof ApiError && e.status >= 400 && e.status < 500;

type Pending = { requestId: string; key: string };

/**
 * Guarded start/poll/cancel/retry for one Journal job. Request identities survive an uncertain
 * acknowledgement so a lost response never starts a second job; drafts live with the caller.
 */
export function useJournalJob(campaignId: string, onFinished?: (job: JournalJobView) => void) {
  const [job, setJob] = useState<JournalJobView | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    guard = useRef(false),
    pending = useRef<Pending | null>(null),
    scope = useRef(campaignId),
    finished = useRef<string | null>(null),
    onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  // Navigating to another campaign drops the job and ignores late answers for the old one.
  useEffect(() => {
    scope.current = campaignId;
    pending.current = null;
    finished.current = null;
    setJob(null);
    setError('');
    return () => {
      scope.current = '';
    };
  }, [campaignId]);

  const apply = useCallback((next: JournalJobView, owner: string) => {
    if (scope.current !== owner) return;
    setJob(next);
    if (!next.active && finished.current !== `${next.id}:${next.status}`) {
      finished.current = `${next.id}:${next.status}`;
      onFinishedRef.current?.(next);
    }
  }, []);

  const run = useCallback(
    async (path: string, body: Record<string, unknown>, reuse: boolean) => {
      if (guard.current) return null;
      guard.current = true;
      setBusy(true);
      const owner = campaignId;
      const key = JSON.stringify([path, body]);
      // Reuse the identity only for the identical request that may already have been accepted.
      const identity =
        reuse && pending.current?.key === key
          ? pending.current
          : { requestId: crypto.randomUUID(), key };
      if (reuse) pending.current = identity;
      try {
        const next = await request<JournalJobView>(
          path,
          json('POST', { requestId: identity.requestId, ...body })
        );
        if (reuse) pending.current = null;
        apply(next, owner);
        if (scope.current === owner) setError('');
        return next;
      } catch (e) {
        if (reuse && definiteFailure(e)) pending.current = null;
        if (scope.current === owner) setError(errorMessage(e));
        return null;
      } finally {
        guard.current = false;
        if (scope.current === owner) setBusy(false);
      }
    },
    [campaignId, apply]
  );

  const start = useCallback(
    (path: string, body: Record<string, unknown> = {}) => run(path, body, true),
    [run]
  );
  const cancel = useCallback(
    () => (job ? run(`${jobPath(campaignId, job.id)}/cancel`, {}, false) : Promise.resolve(null)),
    [campaignId, job, run]
  );
  const retry = useCallback(
    () => (job ? run(`${jobPath(campaignId, job.id)}/retry`, {}, false) : Promise.resolve(null)),
    [campaignId, job, run]
  );

  const [pollFailure, setPollFailure] = useState(false);
  const refresh = useCallback(async () => {
    if (!job) return;
    const owner = campaignId;
    try {
      const next = await request<JournalJobView>(jobPath(campaignId, job.id));
      setPollFailure(false);
      apply(next, owner);
    } catch (e) {
      if (scope.current === owner) {
        setPollFailure(true);
        setError(errorMessage(e));
      }
    }
  }, [campaignId, job, apply]);

  // Sequential polling: one read in flight, the next scheduled after the answer arrives.
  useEffect(() => {
    if (!job?.active || pollFailure) return;
    const timer = setTimeout(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [job, pollFailure, refresh]);

  const attach = useCallback(
    (existing: JournalJobView) => apply(existing, campaignId),
    [campaignId, apply]
  );
  return { job, error, busy, start, cancel, retry, refresh, pollFailure, attach };
}
