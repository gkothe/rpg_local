import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, errorMessage, json, request } from '../../services/client';
import type {
  MemoryRebuildApplyResult,
  MemoryRebuildJobView,
  MemoryRebuildPage,
} from '../../services/types';

/** Delay between sequential status reads; the next one is scheduled only after the last answers. */
const POLL_INTERVAL_MS = 1000;

const rebuildPath = (campaignId: string) => `/campaigns/${campaignId}/memory/rebuilds`;

/** A response proves the request failed only when the server answered with a client error. */
const definiteFailure = (e: unknown) => e instanceof ApiError && e.status >= 400 && e.status < 500;

/**
 * Guarded start/poll/act for one campaign's memory rebuild. A request identity is kept for an
 * identical action whose acknowledgement was lost, so retrying never repeats work on the server.
 */
export function useMemoryRebuild(
  campaignId: string,
  enabled: boolean,
  onApplied?: () => Promise<void> | void,
  purpose = 'memory'
) {
  const [job, setJob] = useState<MemoryRebuildJobView | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [foreign, setForeign] = useState<MemoryRebuildJobView | null>(null),
    [pollFailure, setPollFailure] = useState(false),
    guard = useRef(false),
    pending = useRef(new Map<string, string>()),
    scope = useRef(campaignId),
    onAppliedRef = useRef(onApplied);
  onAppliedRef.current = onApplied;

  // Navigating to another campaign drops the job and ignores late answers for the old one.
  useEffect(() => {
    scope.current = campaignId;
    pending.current.clear();
    setJob(null);
    setForeign(null);
    setError('');
    setLoaded(false);
    setPollFailure(false);
    return () => {
      scope.current = '';
    };
  }, [campaignId]);

  // Reloading the Journal restores a running or reviewable rebuild from the server.
  useEffect(() => {
    if (!enabled) return;
    const owner = campaignId;
    void request<MemoryRebuildPage>(`${rebuildPath(campaignId)}?limit=1`)
      .then((page) => {
        if (scope.current !== owner) return;
        // A job of another purpose belongs to its own panel; this one only reports it.
        const mine = page.current && (page.current.purpose ?? 'memory') === purpose;
        setJob((existing) => existing ?? (mine ? page.current : null));
        setForeign(page.current && !mine ? page.current : null);
        setLoaded(true);
      })
      .catch((e) => {
        if (scope.current !== owner) return;
        setError(errorMessage(e));
        setLoaded(true);
      });
  }, [campaignId, enabled, purpose]);

  const act = useCallback(
    async (
      path: string,
      body: Record<string, unknown>,
      options: { onResult?: (result: unknown) => MemoryRebuildJobView | null } = {}
    ) => {
      if (guard.current) return;
      guard.current = true;
      setBusy(true);
      const owner = campaignId;
      const key = JSON.stringify([path, body]);
      const requestId = pending.current.get(key) ?? crypto.randomUUID();
      pending.current.set(key, requestId);
      try {
        const result = await request<unknown>(path, json('POST', { requestId, ...body }));
        pending.current.delete(key);
        if (scope.current !== owner) return;
        const next = options.onResult ? options.onResult(result) : (result as MemoryRebuildJobView);
        if (next) setJob(next);
        setPollFailure(false);
        setError('');
      } catch (e) {
        if (definiteFailure(e)) pending.current.delete(key);
        if (scope.current === owner) setError(errorMessage(e));
      } finally {
        guard.current = false;
        if (scope.current === owner) setBusy(false);
      }
    },
    [campaignId]
  );

  const refresh = useCallback(async () => {
    if (!job) return;
    const owner = campaignId;
    try {
      const next = await request<MemoryRebuildJobView>(`${rebuildPath(campaignId)}/${job.id}`);
      if (scope.current !== owner) return;
      setPollFailure(false);
      setJob(next);
    } catch (e) {
      if (scope.current === owner) {
        setPollFailure(true);
        setError(errorMessage(e));
      }
    }
  }, [campaignId, job]);

  // Sequential polling: one read in flight, the next scheduled after the answer arrives.
  useEffect(() => {
    if (!job?.active || pollFailure) return;
    const timer = setTimeout(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [job, pollFailure, refresh]);

  const start = useCallback(
    () => act(rebuildPath(campaignId), purpose === 'memory' ? {} : { purpose }),
    [act, campaignId, purpose]
  );
  const command = useCallback(
    (action: string, extra: Record<string, unknown> = {}) => {
      if (!job) return Promise.resolve();
      const path = `${rebuildPath(campaignId)}/${job.id}/${action}`;
      if (action !== 'apply' && action !== 'discard') return act(path, extra);
      return act(path, extra, {
        onResult: (result) => {
          const decided = result as MemoryRebuildApplyResult;
          if (action === 'apply') void onAppliedRef.current?.();
          return decided.job;
        },
      });
    },
    [act, campaignId, job]
  );
  return { job, foreign, error, busy, loaded, pollFailure, start, command, refresh };
}
