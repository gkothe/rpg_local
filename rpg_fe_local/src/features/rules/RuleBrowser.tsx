import { useEffect, useRef, useState } from 'react';
import { request, errorMessage } from '../../services/client';
import type {
  RuleSystemMetadata,
  RuleLookupResult,
  RulePageProvenance,
} from '../../services/types';
import { ErrorNotice, Field } from '../../components/Controls';
function provenance(pages: RulePageProvenance | null | undefined) {
  if (!pages) return 'Page provenance unknown';
  return `${pages.precision} PDF pages: ${pages.pdfPages.filter((page) => page !== null).join(', ') || 'unknown'}; printed: ${pages.printedPages.filter((page) => page !== null).join(', ') || 'unknown'}`;
}
export default function RuleBrowser({ system }: { system: RuleSystemMetadata }) {
  const [query, setQuery] = useState('');
  const [column, setColumn] = useState(system.populatedColumns[0] ?? '');
  const [source, setSource] = useState(system.sources[0]?.slug ?? '');
  const [result, setResult] = useState<RuleLookupResult | null>(null);
  const [lastLookup, setLastLookup] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    []
  );
  async function load(endpoint: string, nextCursor?: string | null) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError('');
    const current = generation.current;
    const path = nextCursor ? `${endpoint}&cursor=${encodeURIComponent(nextCursor)}` : endpoint;
    try {
      const next = await request<RuleLookupResult>(`/rule-systems/${system.systemId}/${path}`);
      if (current !== generation.current) return;
      setResult(next);
      setLastLookup(endpoint);
    } catch (error) {
      if (current === generation.current) setError(errorMessage(error));
    } finally {
      if (current === generation.current) {
        guard.current = false;
        setBusy(false);
      }
    }
  }
  if (!system.sources.length) return <p>No books have been published for this system.</p>;
  return (
    <section className="panel">
      <h2>Browse / Search</h2>
      <p className="muted">
        Read original passages. Summaries and extracted fields help navigation.
      </p>
      <ErrorNotice message={error} />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void load(`search?query=${encodeURIComponent(query)}`);
        }}
      >
        <Field label="Search rules">
          <input value={query} onChange={(event) => setQuery(event.target.value)} required />
        </Field>
        <button disabled={busy || !query.trim()} type="submit">
          Search
        </button>
      </form>
      <div className="form-grid">
        <Field label="Column">
          <select value={column} onChange={(event) => setColumn(event.target.value)}>
            {system.populatedColumns.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </Field>
        <Field label="Book">
          <select value={source} onChange={(event) => setSource(event.target.value)}>
            {system.sources.map((book) => (
              <option value={book.slug} key={book.slug}>
                {book.title}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <button
        disabled={busy || !column || !source}
        onClick={() =>
          void load(`nodes?view=children&path=${encodeURIComponent(`${column}.${source}`)}`)
        }
      >
        Browse children
      </button>
      {busy && <p role="status">Loading rule page…</p>}
      {result?.entries && (
        <ul>
          {result.entries.map((entry, index) => (
            <li key={entry.path ?? index}>
              <strong>{entry.name}</strong>
              {entry.derived && <span> — derived navigation only</span>}
              <p>{entry.snippet}</p>
              <small>{provenance(entry.pages)}</small>
              {entry.path && (
                <div>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void load(
                        `nodes?path=${encodeURIComponent(entry.path!)}${entry.locator ? `&locator=${encodeURIComponent(entry.locator)}` : ''}`
                      )
                    }
                  >
                    Read {entry.name}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void load(`nodes?view=children&path=${encodeURIComponent(entry.path!)}`)
                    }
                  >
                    Children of {entry.name}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {result && !result.entries && (
        <article>
          <h3>{result.path}</h3>
          <p>{provenance(result.pages)}</p>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{result.text}</pre>
          <small>
            Direct text offsets {result.start}–{result.end}; revision {result.revision}
          </small>
        </article>
      )}
      {result?.omitted && <p>Partial page; more content is available.</p>}
      {result?.cursor && (
        <button
          disabled={busy}
          onClick={() => void load(lastLookup.replace(/&locator=[^&]*/, ''), result.cursor)}
        >
          Next page
        </button>
      )}
      {result?.entries?.length === 0 && <p>No matching rules or children.</p>}
    </section>
  );
}
