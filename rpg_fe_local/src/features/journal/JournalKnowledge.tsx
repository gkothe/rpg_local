import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  JournalEntry,
  JournalEvidenceDetail,
  JournalPage,
  Settings,
} from '../../services/types';
import { ApiError, errorMessage, request } from '../../services/client';
import { ErrorNotice } from '../../components/Controls';
import JournalCorrection from './JournalCorrection';
import { JournalJobPanel } from './JournalJob';
import { useJournalJob } from './useJournalJob';

const journalPath = (campaignId: string) => `/campaigns/${campaignId}/journal`;

export default function JournalKnowledge({
  campaignId,
  revision,
  options,
  initialEntryId,
  onChanged,
}: {
  campaignId: string;
  revision: number;
  options: Settings | null;
  initialEntryId?: string | null;
  /** Refresh canonical campaign data after a confirmed Journal commit. */
  onChanged?: () => void;
}) {
  const [query, setQuery] = useState(''),
    [includePast, setIncludePast] = useState(false),
    [page, setPage] = useState<JournalPage | null>(null),
    [entries, setEntries] = useState<JournalEntry[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [selectedId, setSelectedId] = useState<string | null>(initialEntryId ?? null),
    sequence = useRef(0);

  const load = useCallback(
    async (cursor?: string) => {
      const id = ++sequence.current;
      const params = new URLSearchParams({ query, includePast: String(includePast) });
      if (cursor) params.set('cursor', cursor);
      setLoading(true);
      try {
        const next = await request<JournalPage>(`${journalPath(campaignId)}/entries?${params}`);
        if (id !== sequence.current) return;
        // A malformed answer is shown as a failure with Retry instead of breaking the page.
        if (!Array.isArray(next?.entries) || !Array.isArray(next?.groups))
          throw new Error('The server returned an incomplete Journal response.');
        setPage(next);
        setEntries((current) => (cursor ? [...current, ...next.entries] : next.entries));
        setError('');
      } catch (e) {
        if (id !== sequence.current) return;
        // A changed view invalidates the cursor; start again from the first page.
        if (cursor && e instanceof ApiError && e.code === 'journal_changed') void load();
        else setError(errorMessage(e));
      } finally {
        if (id === sequence.current) setLoading(false);
      }
    },
    [campaignId, query, includePast]
  );

  useEffect(() => {
    void load();
  }, [load, revision]);
  // Drop any response still in flight once the component goes away.
  useEffect(() => {
    const guard = sequence;
    return () => {
      guard.current++;
    };
  }, []);

  const backfill = useJournalJob(campaignId, (finished) => {
    // Entries are added only at successful completion; read them back once it is confirmed.
    if (finished.status === 'completed') {
      onChanged?.();
      void load();
    }
  });
  const filtered = !!query.trim() || includePast;
  return (
    <div className="panel stack journal-knowledge" aria-label="Campaign knowledge">
      <h3>What your character knows</h3>
      <div className="journal-filters">
        <label className="field">
          <span>Search knowledge</span>
          <input
            type="search"
            value={query}
            maxLength={options?.journal?.limits.queryMaxChars}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={includePast}
            onChange={(e) => setIncludePast(e.target.checked)}
          />
          Show completed/past items
        </label>
      </div>
      <details className="journal-fill">
        <summary>Fill from past conversations</summary>
        <div className="stack">
          <p className="muted">
            The selected campaign CLI/model reads your saved conversations and adds missing people,
            places and unfinished business. This uses your provider allowance and can take a while.
            Entries are added only when it finishes; cancelling or failing adds nothing. Your
            current entries stay readable meanwhile.
          </p>
          <button
            disabled={backfill.busy || !!backfill.job?.active}
            onClick={() => void backfill.start(`${journalPath(campaignId)}/backfills`)}
          >
            Fill from past conversations
          </button>
          <JournalJobPanel
            job={backfill.job}
            error={backfill.error}
            busy={backfill.busy}
            pollFailure={backfill.pollFailure}
            onCancel={() => void backfill.cancel()}
            onRetry={() => void backfill.retry()}
            onRefresh={() => void backfill.refresh()}
          />
          {backfill.job?.status === 'completed' && backfill.job.progress && (
            <p role="status">
              Finished: {backfill.job.progress.created ?? 0} added,{' '}
              {backfill.job.progress.skipped ?? 0} skipped.
            </p>
          )}
        </div>
      </details>
      <ErrorNotice message={error} />
      {error && <button onClick={() => void load()}>Retry knowledge load</button>}
      {loading && !entries.length && !error && <p role="status">Loading knowledge…</p>}
      {!loading && !error && page && !entries.length && (
        <p className="muted" role="status">
          {filtered
            ? 'No matching knowledge found.'
            : 'Nothing recorded yet. People, places and unfinished business appear here as you play.'}
        </p>
      )}
      {page?.groups
        .filter((g) => entries.some((e) => e.group === g.id))
        .map((g) => (
          <section key={g.id} className="journal-group" aria-label={g.label}>
            <h4>
              {g.label} <span className="muted">({g.count})</span>
            </h4>
            {entries
              .filter((e) => e.group === g.id)
              .map((e) => (
                <article
                  key={e.id}
                  className={`journal-entry${e.status === 'active' ? '' : ' past'}`}
                >
                  <h5>{e.title}</h5>
                  <p className="journal-badges">
                    <span>{e.statusLabel}</span>
                    {e.certainty !== 'established' && <span>{e.certaintyLabel}</span>}
                  </p>
                  <p className="prose">{e.overview}</p>
                  <button
                    aria-expanded={selectedId === e.id}
                    onClick={() => setSelectedId(selectedId === e.id ? null : e.id)}
                  >
                    {selectedId === e.id ? `Hide details for ${e.title}` : `Details for ${e.title}`}
                  </button>
                  {selectedId === e.id && (
                    <EntryDetail
                      key={e.id}
                      campaignId={campaignId}
                      entryId={e.id}
                      revision={revision}
                      options={options}
                      onSelect={setSelectedId}
                      onChanged={() => {
                        onChanged?.();
                        void load();
                      }}
                    />
                  )}
                </article>
              ))}
          </section>
        ))}
      {page?.nextCursor && (
        <button disabled={loading} onClick={() => void load(page.nextCursor!)}>
          Show more
        </button>
      )}
    </div>
  );
}

function EntryDetail({
  campaignId,
  entryId,
  revision,
  options,
  onSelect,
  onChanged,
}: {
  campaignId: string;
  entryId: string;
  revision: number;
  options: Settings | null;
  onSelect: (id: string) => void;
  onChanged: () => void;
}) {
  const [entry, setEntry] = useState<JournalEntry | null>(null),
    [error, setError] = useState(''),
    [quote, setQuote] = useState<{ id: string; detail: JournalEvidenceDetail } | null>(null);
  useEffect(() => {
    let current = true;
    setError('');
    request<JournalEntry>(`${journalPath(campaignId)}/entries/${entryId}`)
      .then((value) => current && setEntry(value))
      .catch((e) => current && setError(errorMessage(e)));
    return () => {
      current = false;
    };
  }, [campaignId, entryId, revision]);
  async function openQuote(evidenceId: string) {
    try {
      const detail = await request<JournalEvidenceDetail>(
        `${journalPath(campaignId)}/entries/${entryId}/evidence/${evidenceId}`
      );
      setQuote({ id: evidenceId, detail });
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  if (error) return <ErrorNotice message={error} />;
  if (!entry) return <p role="status">Loading details…</p>;
  return (
    <div className="journal-detail stack">
      <p className="prose">{entry.text}</p>
      {entry.connections.length > 0 && (
        <div>
          <strong>Connected</strong>
          <ul className="journal-links">
            {entry.connections.map((c) => (
              <li key={c.id}>
                <button onClick={() => onSelect(c.id)}>{c.title}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!!entry.evidence?.length && (
        <div>
          <strong>Sources</strong>
          <ul className="journal-links">
            {entry.evidence.map((ev) => (
              <li key={ev.id}>
                {ev.kind === 'turn' ? (
                  ev.available ? (
                    <Link to={`/campaigns/${campaignId}?tab=play&turn=${ev.turnId}`}>
                      {ev.label}
                    </Link>
                  ) : (
                    <span className="muted">{ev.label} (no longer available)</span>
                  )
                ) : (
                  <button onClick={() => void openQuote(ev.id)}>{ev.label}</button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {quote && quote.detail.kind !== 'turn' && (
        <blockquote className="journal-quote">{quote.detail.quote}</blockquote>
      )}
      {!!entry.history?.length && (
        <div>
          <strong>History</strong>
          <ul className="journal-history">
            {entry.history.map((h, i) => (
              <li key={i}>
                {h.summary} · <time dateTime={h.at}>{new Date(h.at).toLocaleString()}</time>
                {h.reason && <span className="muted"> · {h.reason}</span>}
                {h.changes?.map((c) => (
                  <div key={c.field} className="journal-change">
                    {c.label}: {c.before ?? 'none'} → {c.after ?? 'none'}
                  </div>
                ))}
                {h.turnId && (
                  <>
                    {' '}
                    <Link to={`/campaigns/${campaignId}?tab=play&turn=${h.turnId}`}>
                      Open conversation
                    </Link>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <JournalCorrection
        campaignId={campaignId}
        entryId={entryId}
        options={options}
        onChanged={onChanged}
      />
    </div>
  );
}
