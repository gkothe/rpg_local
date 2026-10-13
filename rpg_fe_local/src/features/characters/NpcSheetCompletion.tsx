import { useEffect, useRef, useState } from 'react';
import { request, json, errorMessage } from '../../services/client';
import type { NpcSheetCompletionView } from '../../services/types';
import { ErrorNotice } from '../../components/Controls';

export default function NpcSheetCompletion({
  campaignId,
  characterId,
  enabled,
  onSaved,
}: {
  campaignId: string;
  characterId: string;
  enabled: boolean;
  onSaved: () => Promise<void>;
}) {
  const [job, setJob] = useState<NpcSheetCompletionView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const guard = useRef(false),
    generation = useRef(0);
  const mutation = useRef(0);
  const startId = useRef<string | null>(null),
    decisionId = useRef<{ jobId: string; action: string; requestId: string } | null>(null);
  const base = `/campaigns/${campaignId}/characters/${characterId}/sheet-completions`;
  useEffect(() => {
    const token = ++generation.current;
    return () => {
      generation.current = token + 1;
    };
  }, [base, enabled]);
  useEffect(() => {
    const token = generation.current;
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      const mutationToken = mutation.current;
      try {
        const result = await request<NpcSheetCompletionView | null>(base);
        if (cancelled || token !== generation.current || mutationToken !== mutation.current) return;
        if (!guard.current) {
          setJob(result);
          if (result?.canStart) startId.current = null;
        }
        if (result?.active) timer = setTimeout(() => void load(), 1000);
      } catch (e) {
        if (!cancelled && token === generation.current && mutationToken === mutation.current)
          setError(errorMessage(e));
      }
    }
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [base, enabled, job?.active]);
  async function act(action?: { id: string; decision: boolean }) {
    if (guard.current) return;
    guard.current = true;
    mutation.current++;
    setBusy(true);
    setError('');
    const token = generation.current;
    try {
      let result: NpcSheetCompletionView;
      if (!action) {
        startId.current ??= crypto.randomUUID();
        result = await request<NpcSheetCompletionView>(
          base,
          json('POST', { requestId: startId.current })
        );
      } else if (job) {
        if (action.decision) {
          if (decisionId.current?.jobId !== job.id || decisionId.current?.action !== action.id)
            decisionId.current = {
              jobId: job.id,
              action: action.id,
              requestId: crypto.randomUUID(),
            };
          result = await request<NpcSheetCompletionView>(
            `${base}/${job.id}/decisions`,
            json('POST', { requestId: decisionId.current.requestId, decision: action.id })
          );
        } else
          result = await request<NpcSheetCompletionView>(
            `${base}/${job.id}/actions`,
            json('POST', { action: action.id })
          );
      } else return;
      if (token !== generation.current) return;
      setJob(result);
      if (result.canStart) startId.current = null;
      if (action?.decision) await onSaved();
    } catch (e) {
      if (token === generation.current) setError(errorMessage(e));
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="panel stack npc-sheet-completion" aria-label="Complete NPC sheet">
      <p>
        Complete missing skills and stats for this campaign’s game system. Review additions before
        saving. Established values stay unchanged.
      </p>
      <ErrorNotice message={error || job?.error || ''} />
      {(!job || job.canStart) && (
        <button disabled={busy} onClick={() => void act()}>
          Complete sheet
        </button>
      )}
      {job?.active && <p role="status">Reading rules and completing the sheet…</p>}
      {job?.systemName && (
        <p>
          {job.systemName}
          {job.basis !== 'book' ? ' · Provisional mechanics' : ' · Based on retrieved rules'}
        </p>
      )}
      {job?.conflicts.map((conflict, i) => (
        <p key={i} role="alert">
          {conflict}
        </p>
      ))}
      {!!job?.additions.length && (
        <details open>
          <summary>Proposed additions</summary>
          <ul>
            {job.additions.map((item, i) => (
              <li key={i}>
                <strong>{item.path.join(' → ')}</strong>
                <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {JSON.stringify(item.value, null, 2)}
                </pre>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="row wrap">
        {job?.actions.map((action) => (
          <button key={action.id} disabled={busy} onClick={() => void act(action)}>
            {action.label}
          </button>
        ))}
      </div>
    </section>
  );
}
