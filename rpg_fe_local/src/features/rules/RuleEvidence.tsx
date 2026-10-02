import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { RuleContext, RuleRead, Turn } from '../../services/types';
import { requestCollection, errorMessage } from '../../services/client';
import { ErrorNotice } from '../../components/Controls';

export default function RuleEvidence({
  turn,
  current,
  terminal,
}: {
  turn: Turn;
  current?: RuleContext;
  terminal: boolean;
}) {
  const [reads, setReads] = useState(turn.ruleReads ?? []);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  if (!terminal || (!turn.ruleContext && !turn.ruleCitations?.length && !reads.length)) return null;
  const outdated =
    current &&
    turn.ruleContext &&
    (current.systemId !== turn.ruleContext.systemId ||
      current.contentHash !== turn.ruleContext.contentHash ||
      current.revision !== turn.ruleContext.revision);
  return (
    <details
      className="changes rule-evidence"
      onToggle={async (event) => {
        if (!event.currentTarget.open || guard.current || reads.length) return;
        guard.current = true;
        setBusy(true);
        try {
          const result = await requestCollection<RuleRead>(
            `/campaigns/${turn.campaignId}/turns/${turn.id}/rule-reads`
          );
          if (mounted.current) {
            setReads(result);
            setError('');
          }
        } catch (error) {
          if (mounted.current) setError(errorMessage(error));
        } finally {
          guard.current = false;
          if (mounted.current) setBusy(false);
        }
      }}
    >
      <summary>Rule evidence · {turn.ruleCitations?.length ?? 0} citations</summary>
      <p>
        {turn.ruleContext?.systemName} · revision {turn.ruleContext?.revision} · hash{' '}
        {turn.ruleContext?.contentHash}
      </p>
      {turn.undone && <p>Undone attempt audit</p>}
      {turn.error && <p>Failed attempt audit; these reads are not active narrative history.</p>}
      {outdated && (
        <p className="notice">
          The current library differs. Saved quotations describe this attempt; current nodes may
          have changed.
        </p>
      )}
      {(turn.ruleCitations ?? []).map((citation, index) => (
        <figure key={`${citation.receiptId}-${index}`}>
          <blockquote style={{ whiteSpace: 'pre-wrap' }}>{citation.quote}</blockquote>
          <figcaption>
            {citation.source} · {citation.path} · {citation.precision} PDF pages{' '}
            {citation.pdfPages.join(', ') || 'unknown'} · printed{' '}
            {citation.printedPages.join(', ') || 'unknown'}
          </figcaption>
          <Link to={`/rules/${current?.systemId ?? citation.systemId}`}>
            Browse current library
          </Link>
        </figure>
      ))}
      {busy && <p role="status">Loading saved rule reads…</p>}
      <ErrorNotice message={error} />
      <ul>
        {reads.map((read) => (
          <li key={read.id}>
            {read.tool} · receipt {read.id} · revision {read.context.revision}
            {read.payload.error ? ' · unsuccessful lookup' : ''}
          </li>
        ))}
      </ul>
    </details>
  );
}
