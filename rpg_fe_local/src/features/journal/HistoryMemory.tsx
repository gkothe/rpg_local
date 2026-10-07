import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CampaignDetail,
  HistoryDetail,
  HistoryItem,
  HistoryPage,
  HistoryStatus,
  Settings,
} from '../../services/types';
import { ErrorNotice } from '../../components/Controls';
import { ApiError, errorMessage, json, request } from '../../services/client';
import { MemoryText } from './MemoryText';
import { useMemoryRebuild } from './useMemoryRebuild';

const COMPACT_PURPOSE = 'compact_history';

/** A response proves the request failed only when the server answered with a client error. */
const definiteFailure = (e: unknown) => e instanceof ApiError && e.status >= 400 && e.status < 500;

/**
 * Selective history: what is searchable, what is protected, what reaches the prompt, and the
 * Prepare, Review and Activate flow. Everything stays reversible; originals are never deleted.
 */
export default function HistoryMemory({
  campaign,
  options,
  active = true,
  onChanged,
}: {
  campaign: CampaignDetail;
  options: Settings | null;
  active?: boolean;
  onChanged?: () => Promise<void> | void;
}) {
  const base = `/campaigns/${campaign.id}/history`;
  const [query, setQuery] = useState(''),
    [kind, setKind] = useState(''),
    [items, setItems] = useState<HistoryItem[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [status, setStatus] = useState<HistoryStatus | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [details, setDetails] = useState<Record<string, HistoryDetail>>({}),
    [preserveMemory, setPreserveMemory] = useState(false),
    sequence = useRef(0),
    guard = useRef(false),
    pending = useRef(new Map<string, string>()),
    scope = useRef(campaign.id);
  const rebuild = useMemoryRebuild(campaign.id, active, onChanged, COMPACT_PURPOSE);
  const kindOptions = options?.history?.kindOptions ?? [];
  const reasonLabel = (id: string) =>
    options?.history?.reasonOptions.find((o) => o.id === id)?.label ?? id;
  const kindLabel = (id: string) => kindOptions.find((o) => o.id === id)?.label ?? id;

  useEffect(() => {
    scope.current = campaign.id;
    pending.current.clear();
    return () => {
      scope.current = '';
    };
  }, [campaign.id]);

  const load = useCallback(
    async (next: string | null) => {
      const id = ++sequence.current;
      const owner = campaign.id;
      const params = new URLSearchParams();
      if (query.trim()) params.set('query', query.trim());
      if (kind) params.set('kind', kind);
      if (next) params.set('cursor', next);
      try {
        const page = await request<HistoryPage>(`${base}?${params}`);
        if (id !== sequence.current || scope.current !== owner) return;
        if (!Array.isArray(page?.items) || !page.status)
          throw new Error('The server returned an incomplete history response.');
        setItems((existing) => (next ? [...existing, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setStatus(page.status);
        setError('');
      } catch (e) {
        if (id === sequence.current && scope.current === owner) setError(errorMessage(e));
      }
    },
    [base, campaign.id, query, kind]
  );
  useEffect(() => {
    if (active) void load(null);
  }, [active, load, campaign.revision, rebuild.job?.status]);

  /** Guarded PATCH with a request identity that survives an uncertain acknowledgement. */
  async function mutate(path: string, body: Record<string, unknown>) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    const owner = campaign.id;
    const key = JSON.stringify([path, body]);
    const requestId = pending.current.get(key) ?? crypto.randomUUID();
    pending.current.set(key, requestId);
    try {
      const result = await request<{ status: HistoryStatus }>(
        path,
        json('PATCH', { requestId, ...body })
      );
      pending.current.delete(key);
      if (scope.current !== owner) return;
      setStatus(result.status);
      setError('');
      await load(null);
      await onChanged?.();
    } catch (e) {
      if (definiteFailure(e)) pending.current.delete(key);
      if (scope.current === owner) setError(errorMessage(e));
    } finally {
      guard.current = false;
      if (scope.current === owner) setBusy(false);
    }
  }

  async function toggleDetails(item: HistoryItem) {
    if (details[item.id]) {
      setDetails(({ [item.id]: _removed, ...rest }) => rest);
      return;
    }
    try {
      const detail = await request<HistoryDetail>(`${base}/${item.id}?originals=true`);
      setDetails((existing) => ({ ...existing, [item.id]: detail }));
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function moreOriginals(item: HistoryItem) {
    const current = details[item.id];
    if (!current?.nextCursor) return;
    try {
      const page = await request<HistoryDetail>(
        `${base}/${item.id}?originals=true&cursor=${encodeURIComponent(current.nextCursor)}`
      );
      setDetails((existing) => ({
        ...existing,
        [item.id]: {
          ...current,
          originals: [...current.originals, ...page.originals],
          nextCursor: page.nextCursor,
        },
      }));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const { job } = rebuild;
  const reviewing = job?.status === 'ready' && !!job.candidate;
  const knowledge = (campaign.knowledge ?? []).filter((r) => r.status === 'active');
  const memory = campaign.memory?.valid ? campaign.memory : null;
  const overflow = status?.diagnostics.overflowBytes ?? 0;

  return (
    <div className="panel stack" aria-label="History recall">
      <h3>History recall</h3>
      <small className="muted">
        Older history can stay out of the prompt and still be found by the GM. Nothing is deleted:
        every conversation and memory checkpoint is kept.
      </small>
      <ErrorNotice message={error || rebuild.error} />
      {status && (
        <div className="stack">
          <p role="status">
            {status.enabled ? 'Selective history is on.' : 'Selective history is off.'} Summaries
            cover {status.coveredTurns} of {status.totalTurns} turns · {status.searchableSections}{' '}
            searchable sections.
          </p>
          {status.pendingRefresh && status.enabled && (
            <small className="muted">
              Newer history is not summarized yet; it stays in the prompt until you prepare the
              history again.
            </small>
          )}
          {status.unavailableProtectedIds.length > 0 && (
            <small role="alert">
              {status.unavailableProtectedIds.length} protected item(s) are no longer available and
              need review.
            </small>
          )}
          {status.enabled && (
            <small className="muted">
              Supplied to the GM: {status.diagnostics.suppliedBytes} of{' '}
              {status.diagnostics.targetBytes} bytes target ({status.diagnostics.mandatoryBytes}{' '}
              protected or overview).
              {Object.entries(status.diagnostics.omitted.reasonCounts).map(([reason, count]) => (
                <span key={reason}>
                  {' '}
                  {reasonLabel(reason)}: {count}.
                </span>
              ))}
            </small>
          )}
          {overflow > 0 && (
            <small role="alert">
              Protected material exceeds the soft target by {overflow} bytes. It is still supplied;
              unprotect some items to reduce it.
            </small>
          )}
        </div>
      )}
      <div className="journal-job-actions">
        {!status?.enabled || status?.pendingRefresh ? (
          <button
            disabled={rebuild.busy || !rebuild.loaded || !!job?.active || reviewing}
            onClick={() => void rebuild.start()}
          >
            Prepare compact history
          </button>
        ) : null}
        {status?.enabled && (
          <button
            disabled={busy}
            onClick={() => {
              if (!confirm('Return new actions to the full memory?')) return;
              void mutate(`${base}/settings`, { enabled: false, expectedEnabled: true });
            }}
          >
            Turn off selective history
          </button>
        )}
      </div>
      <small className="muted">
        Preparing summarizes your history with your provider allowance and shows a draft first.
        Nothing is switched on until you activate it.
      </small>
      <p role="status" aria-live="polite">
        {job
          ? `${job.statusLabel}${
              job.active ? `: step ${job.processedTurns} of ${job.totalTurns}` : ''
            }`
          : ''}
      </p>
      {job && job.allowedActions.length > 0 && !reviewing && (
        <div className="journal-job-actions">
          {job.allowedActions.includes('cancel') && (
            <button disabled={rebuild.busy} onClick={() => void rebuild.command('cancel')}>
              Cancel
            </button>
          )}
          {job.allowedActions.includes('resume') && (
            <button disabled={rebuild.busy} onClick={() => void rebuild.command('resume')}>
              Retry
            </button>
          )}
          {rebuild.pollFailure && (
            <button onClick={() => void rebuild.refresh()}>Check status again</button>
          )}
        </div>
      )}
      {reviewing && job.candidate && (
        <div className="stack">
          <h4>Review before activating</h4>
          <small className="muted">
            {job.compact
              ? `${job.compact.sections} sections and ${job.compact.chapters} chapters were prepared. `
              : ''}
            Covers {job.candidate.coveredTurnIds.length} turns; the newest conversations stay
            verbatim.
          </small>
          <h5>Overview</h5>
          <MemoryText text={job.candidate.text} />
          {memory && (
            <>
              <h5>Existing memory (kept in full, not sent while selective history is on)</h5>
              <MemoryText text={memory.text} />
              <label className="check">
                <input
                  type="checkbox"
                  checked={preserveMemory}
                  onChange={(e) => setPreserveMemory(e.target.checked)}
                />
                Also protect this memory text exactly (use for facts that are not in the
                conversations)
              </label>
            </>
          )}
          <div className="journal-job-actions">
            <button
              disabled={rebuild.busy}
              onClick={() =>
                void rebuild.command('apply', {
                  proposalDigest: job.candidate!.proposalDigest,
                  ...(preserveMemory ? { preserveMemory } : {}),
                })
              }
            >
              Activate
            </button>
            <button disabled={rebuild.busy} onClick={() => void rebuild.command('discard')}>
              Discard
            </button>
          </div>
        </div>
      )}
      <div className="stack">
        <h4>Protected facts</h4>
        {status?.protectedKnowledgeIds.length === 0 && memory === null && (
          <small className="muted">Nothing is protected yet.</small>
        )}
        {(status?.protectedKnowledgeIds ?? []).map((id) => (
          <div key={id} className="journal-job-actions">
            <span>{knowledge.find((r) => r.id === id)?.title ?? 'Unavailable fact'}</span>
            <button
              disabled={busy}
              onClick={() =>
                void mutate(`${base}/protection/knowledge/${id}`, {
                  expected: true,
                  protected: false,
                })
              }
            >
              Unprotect
            </button>
          </div>
        ))}
        <label>
          <span>Protect a fact</span>
          <select
            value=""
            disabled={busy}
            onChange={(e) =>
              e.target.value &&
              void mutate(`${base}/protection/knowledge/${e.target.value}`, {
                expected: false,
                protected: true,
              })
            }
          >
            <option value="">Choose…</option>
            {knowledge
              .filter((r) => !status?.protectedKnowledgeIds.includes(r.id))
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
          </select>
        </label>
        {memory && (
          <button
            disabled={busy}
            onClick={() => {
              const pinned = !!status?.protectedMemoryIds.includes(memory.id);
              void mutate(`${base}/protection/memories/${memory.id}`, {
                expected: pinned,
                protected: !pinned,
              });
            }}
          >
            {status?.protectedMemoryIds.includes(memory.id)
              ? 'Unprotect current memory text'
              : 'Protect current memory text'}
          </button>
        )}
      </div>
      <div className="stack">
        <h4>Search history</h4>
        <label>
          <span>Search</span>
          <input
            value={query}
            maxLength={options?.history?.limits.queryMaxChars}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          <span>Kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All</option>
            {kindOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {items.length === 0 && <small className="muted">No prepared history to show yet.</small>}
        <ul className="stack">
          {items.map((item) => (
            <li key={item.id} className="stack">
              <strong>{item.title}</strong>{' '}
              <small className="muted">
                {kindLabel(item.kind)}
                {item.protected ? ' · Protected' : ''}
                {item.available ? '' : ' · Source unavailable'}
              </small>
              <p>{item.excerpt}</p>
              <div className="journal-job-actions">
                <button onClick={() => void toggleDetails(item)}>
                  {details[item.id] ? 'Hide originals' : 'Show originals'}
                </button>
                {item.kind === 'section' && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void mutate(`${base}/protection/sections/${item.id}`, {
                        expected: item.protected,
                        protected: !item.protected,
                      })
                    }
                  >
                    {item.protected ? 'Unprotect' : 'Protect'}
                  </button>
                )}
              </div>
              {details[item.id] && (
                <div className="stack">
                  {details[item.id]!.originals.map((o) => (
                    <blockquote key={o.turnId}>
                      <p>
                        <em>{o.player}</em>
                      </p>
                      <p>{o.gm}</p>
                    </blockquote>
                  ))}
                  {details[item.id]!.nextCursor && (
                    <button onClick={() => void moreOriginals(item)}>Show more originals</button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        {cursor && <button onClick={() => void load(cursor)}>Load more</button>}
      </div>
    </div>
  );
}
