import { useEffect, useRef, useState } from 'react';
import { request, json, errorMessage, ApiError } from '../../services/client';
import type { CampaignDetail, Settings } from '../../services/types';
import { ErrorNotice, Field } from '../../components/Controls';
import { notifyAdvancement } from './events';
import type { Proposal, Review, ReviewList } from './types';

export default function Advancement({
  campaign,
  options,
  onSaved,
}: {
  campaign: CampaignDetail;
  options: Settings | null;
  onSaved: () => Promise<void>;
}) {
  const base = `/campaigns/${campaign.id}/advancement`;
  const [list, setList] = useState<ReviewList | null>(null),
    [selected, setSelected] = useState<Review | null>(null);
  const [draft, setDraft] = useState<Proposal | null>(null),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [loadError, setLoadError] = useState(''),
    [feedback, setFeedback] = useState(''),
    [busy, setBusy] = useState(false);
  const mounted = useRef(true),
    guard = useRef(false),
    pending = useRef<{ key: string; path: string; body: unknown } | null>(null);
  const selectedRef = useRef<Review | null>(null);
  selectedRef.current = selected;
  const loadedDigest = useRef<string | null>(null);
  function select(review: Review) {
    setSelected(review);
    setDraft(review.proposal ? structuredClone(review.proposal) : null);
    loadedDigest.current = review.proposalDigest;
    setReason(review.adjustmentReason ?? '');
  }
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const next = await request<ReviewList>(`${base}/reviews`);
        if (cancelled) return;
        setList((previous) =>
          previous && previous.reviews.length > next.reviews.length
            ? {
                ...next,
                reviews: [
                  ...next.reviews,
                  ...previous.reviews.filter((r) => !next.reviews.some((n) => n.id === r.id)),
                ],
                nextCursor: previous.nextCursor,
              }
            : next
        );
        setLoadError('');
        const current = selectedRef.current;
        if (current) {
          const r =
            next.reviews.find((r) => r.id === current.id) ??
            (await request<Review>(`${base}/reviews/${current.id}`));
          if (cancelled) return;
          setSelected(r);
          if (r.proposalDigest !== loadedDigest.current) {
            setDraft(r.proposal ? structuredClone(r.proposal) : null);
            loadedDigest.current = r.proposalDigest;
            setFeedback('The saved proposal changed; loaded its current version.');
          }
        } else {
          const active = next.reviews.find(
            (r) => !r.imported && (r.status === 'ready' || r.status === 'running')
          );
          if (active) select(active);
        }
      } catch (e) {
        if (!cancelled) setLoadError(errorMessage(e));
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => {
      cancelled = true;
      mounted.current = false;
      clearInterval(timer);
    };
  }, [base]);
  async function mutate(key: string, path: string, body: Record<string, unknown>) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError('');
    if (pending.current && pending.current.key !== key) {
      setError('Retry the uncertain request before making another decision.');
      guard.current = false;
      setBusy(false);
      return;
    }
    pending.current ??= { key, path, body: { ...body, requestId: crypto.randomUUID() } };
    try {
      const saved = await request<Review | null>(
        pending.current.path,
        json('POST', pending.current.body)
      );
      if (!mounted.current) return;
      pending.current = null;
      if (saved) select(saved);
      if (key === 'apply' || key === 'reverse') {
        notifyAdvancement(campaign.id);
        setFeedback(
          key === 'apply'
            ? `Awarded: ${saved?.awards.map((a) => `${a.recipientName}: ${a.amount ?? 'eligibility'} ${a.unitLabel}`).join('; ') || 'no new progression'}. Update your character sheet manually.`
            : 'Review reversed. Reconcile your character sheet manually.'
        );
      } else setFeedback(saved ? 'Review saved.' : 'No unreviewed completed turns.');
      const refreshed = await request<ReviewList>(`${base}/reviews`);
      if (!mounted.current) return;
      setList(refreshed);
      await onSaved();
    } catch (e) {
      if (mounted.current) {
        if (e instanceof ApiError && e.status >= 400 && e.status < 500) pending.current = null;
        setError(errorMessage(e));
      }
    } finally {
      guard.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const settings = options?.advancement;
  const ready = selected?.status === 'ready' && !selected.imported;
  const dirty = JSON.stringify(draft) !== JSON.stringify(selected?.proposal);
  const update = (changes: Partial<Proposal>) => setDraft((p) => (p ? { ...p, ...changes } : p));
  return (
    <section className="panel stack">
      <h3>Advancement</h3>
      <p>
        Review new completed turns using your game system’s progression rules. Play is continuous:
        there are no session rewards per click. Applying records awards; you update your sheet
        manually.
      </p>
      <p>
        {list
          ? `${list.outstandingTurnCount} completed turns awaiting review.`
          : 'Loading reviews…'}
      </p>
      <ErrorNotice message={error || loadError} />
      {feedback && <p role="status">{feedback}</p>}
      <button
        disabled={
          busy ||
          !settings ||
          list?.reviews.some((r) => !r.imported && (r.status === 'running' || r.status === 'ready'))
        }
        onClick={() => void mutate('start', `${base}/reviews`, {})}
      >
        Review advancement
      </button>
      {pending.current && (
        <button
          disabled={busy}
          onClick={() => void mutate(pending.current!.key, pending.current!.path, {})}
        >
          Retry uncertain request
        </button>
      )}
      {selected && (
        <div className="stack">
          <h4>Review: {selected.status}</h4>
          <p>{selected.reviewedTurnIds.length} captured turns</p>
          <ErrorNotice message={selected.safeError ?? ''} />
          {draft && (
            <>
              <Field label="Review explanation">
                <textarea
                  disabled={!ready}
                  value={draft.explanation}
                  onChange={(e) => update({ explanation: e.target.value })}
                />
              </Field>
              <Field label="Progression policy">
                <textarea
                  disabled={!ready}
                  value={draft.progressionBasis}
                  onChange={(e) => update({ progressionBasis: e.target.value })}
                />
              </Field>
              <Field label="Outcome">
                <select
                  disabled={!ready}
                  value={draft.outcome}
                  onChange={(e) => update({ outcome: e.target.value })}
                >
                  {settings?.outcomes.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              {draft.awards.map((a, index) => (
                <div className="panel stack" key={index}>
                  <h4>
                    {campaign.characters.find((c) => c.id === a.characterId)?.name ?? a.characterId}{' '}
                    — {a.unitLabel}
                  </h4>
                  {a.amount !== null && (
                    <Field label="Award amount">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        disabled={!ready}
                        value={a.amount}
                        onChange={(e) =>
                          update({
                            awards: draft.awards.map((award, i) =>
                              i === index ? { ...award, amount: Number(e.target.value) } : award
                            ),
                          })
                        }
                      />
                    </Field>
                  )}
                  <Field label="Award reason">
                    <textarea
                      disabled={!ready}
                      value={a.reason}
                      onChange={(e) =>
                        update({
                          awards: draft.awards.map((award, i) =>
                            i === index ? { ...award, reason: e.target.value } : award
                          ),
                        })
                      }
                    />
                  </Field>
                  <small>
                    {a.basisKind}: {a.basis}
                  </small>
                  {ready && (
                    <button
                      onClick={() => update({ awards: draft.awards.filter((_, i) => i !== index) })}
                    >
                      Remove award
                    </button>
                  )}
                </div>
              ))}
              {!draft.awards.length && (
                <p>No progression proposed. Apply still marks these turns reviewed.</p>
              )}
              <details>
                <summary>Edit full proposal</summary>
                <p>
                  Edit system, edition, recipients, units, evidence and policy directly. This makes
                  no AI call.
                </p>
                <ProposalJson
                  key={`${selected.id}:${loadedDigest.current}`}
                  proposal={draft}
                  disabled={!ready}
                  onChange={(p) => setDraft(p)}
                />
              </details>
              {ready && (
                <>
                  <Field label="Reason for adjustment">
                    <input value={reason} onChange={(e) => setReason(e.target.value)} />
                  </Field>
                  <button
                    disabled={busy || !dirty || !reason.trim()}
                    onClick={() =>
                      void mutate('adjust', `${base}/reviews/${selected.id}/adjust`, {
                        proposalDigest: selected.proposalDigest,
                        proposal: draft,
                        adjustmentReason: reason,
                      })
                    }
                  >
                    Save proposal edits
                  </button>
                  <button
                    disabled={busy || dirty || draft.outcome !== 'reviewed'}
                    onClick={() =>
                      void mutate('apply', `${base}/reviews/${selected.id}/apply`, {
                        proposalDigest: selected.proposalDigest,
                      })
                    }
                  >
                    Apply awards and mark turns reviewed
                  </button>
                </>
              )}
            </>
          )}
          <div className="row wrap">
            {settings?.actions
              .filter((a) => !selected.imported || a.id === 'reverse')
              .filter((a) =>
                a.id === 'cancel'
                  ? selected.status === 'running'
                  : a.id === 'discard'
                    ? ['ready', 'failed', 'interrupted', 'cancelled'].includes(selected.status)
                    : a.id === 'resume'
                      ? ['failed', 'interrupted', 'cancelled'].includes(selected.status) &&
                        !selected.imported
                      : a.id === 'reverse'
                        ? selected.status === 'applied'
                        : false
              )
              .map((a) => (
                <button
                  key={a.id}
                  disabled={busy}
                  onClick={() => void mutate(a.id, `${base}/reviews/${selected.id}/${a.id}`, {})}
                >
                  {a.label}
                </button>
              ))}
          </div>
        </div>
      )}
      <details>
        <summary>Award history</summary>
        <div className="stack">
          {list?.reviews.map((r) => (
            <button key={r.id} onClick={() => select(r)}>
              {r.status} ·{' '}
              {r.awards
                .map((a) => `${a.recipientName}: ${a.amount ?? 'eligibility'} ${a.unitLabel}`)
                .join('; ') || 'No awards'}{' '}
              · {r.appliedAt ? new Date(r.appliedAt).toLocaleDateString() : 'Unapplied'}
            </button>
          ))}
          {list?.nextCursor && (
            <button
              onClick={async () => {
                try {
                  const next = await request<ReviewList>(
                    `${base}/reviews?cursor=${list.nextCursor}`
                  );
                  if (mounted.current)
                    setList({ ...next, reviews: [...list.reviews, ...next.reviews] });
                } catch (e) {
                  if (mounted.current) setError(errorMessage(e));
                }
              }}
            >
              Load older reviews
            </button>
          )}
        </div>
      </details>
    </section>
  );
}
function ProposalJson({
  proposal,
  disabled,
  onChange,
}: {
  proposal: Proposal;
  disabled: boolean;
  onChange: (p: Proposal) => void;
}) {
  const [text, setText] = useState(JSON.stringify(proposal, null, 2)),
    [error, setError] = useState('');
  const [source, setSource] = useState(proposal);
  if (source !== proposal) {
    setSource(proposal);
    if (text === JSON.stringify(source, null, 2)) setText(JSON.stringify(proposal, null, 2));
  }
  return (
    <>
      <textarea
        aria-label="Full advancement proposal"
        rows={16}
        disabled={disabled}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <ErrorNotice message={error} />
      <button
        disabled={disabled}
        onClick={() => {
          try {
            const p = JSON.parse(text) as Proposal;
            if (
              !p ||
              ![
                'outcome',
                'explanation',
                'progressionBasis',
                'progressionBasisKind',
                'cumulativeSummary',
              ].every((k) => typeof (p as unknown as Record<string, unknown>)[k] === 'string') ||
              !p.rewardSystem ||
              typeof p.rewardSystem.key !== 'string' ||
              typeof p.rewardSystem.label !== 'string' ||
              !Array.isArray(p.pendingObjectives) ||
              !p.pendingObjectives.every((s) => typeof s === 'string') ||
              !Array.isArray(p.ruleEvidence) ||
              !p.ruleEvidence.every(
                (e) => e && typeof e.receiptId === 'string' && typeof e.quote === 'string'
              ) ||
              !Array.isArray(p.awards) ||
              !p.awards.every(
                (a) =>
                  a &&
                  [
                    'characterId',
                    'kind',
                    'unitKey',
                    'unitLabel',
                    'reason',
                    'basis',
                    'basisKind',
                  ].every(
                    (k) => typeof (a as unknown as Record<string, unknown>)[k] === 'string'
                  ) &&
                  (a.amount === null ||
                    (typeof a.amount === 'number' && Number.isFinite(a.amount))) &&
                  Array.isArray(a.evidenceTurnIds) &&
                  a.evidenceTurnIds.every((id) => typeof id === 'string')
              )
            )
              throw new Error('Expected a complete proposal with valid award fields');
            onChange(p);
            setError('');
          } catch (e) {
            setError(errorMessage(e));
          }
        }}
      >
        Use edited proposal
      </button>
    </>
  );
}
