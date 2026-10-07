import { isCompleted } from '../../services/options';
import { useRef, useState } from 'react';
import type { CampaignDetail, Settings } from '../../services/types';
import { Field, ErrorNotice } from '../../components/Controls';
import { request, json, errorMessage } from '../../services/client';
import { useResource } from '../../hooks/useResource';
import JournalKnowledge from './JournalKnowledge';
export default function Journal({
  campaign,
  onSaved,
  options,
  initialEntryId,
  active = true,
}: {
  campaign: CampaignDetail;
  onSaved: () => Promise<void>;
  options: Settings | null;
  initialEntryId?: string | null;
  /** Knowledge loads only while the Journal tab is visible; notes drafts stay mounted. */
  active?: boolean;
}) {
  const baseRevision = useRef(campaign.revision),
    baseNotesRevision = useRef(campaign.notesRevision),
    savingGuard = useRef(false);
  const [feedback, setFeedback] = useState('');
  const [inspectOpen, setInspectOpen] = useState(false);
  const inspectedTurn = [...campaign.turns]
    .reverse()
    .find((turn) => turn.diceSessionId || turn.narrative || turn.context);
  const [notes, setNotes] = useState(campaign.notes),
    [memory, setMemory] = useState(''),
    [coverage, setCoverage] = useState<string[]>([]),
    [error, setError] = useState('');
  async function save(path: string, body: unknown) {
    if (savingGuard.current) return;
    savingGuard.current = true;
    try {
      const saved = await request<CampaignDetail>(path, json('PATCH', body));
      if (path.endsWith('/notes')) baseNotesRevision.current = saved.notesRevision;
      else baseRevision.current = saved.revision;
      await onSaved();
      setError('');
      setFeedback('Changes saved.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      savingGuard.current = false;
    }
  }
  return (
    <section className="stack">
      <h2>Journal & context</h2>
      <ErrorNotice message={error} />
      {feedback && <small role="status">{feedback}</small>}
      <button
        onClick={() => {
          setNotes(campaign.notes);
          setMemory('');
          setCoverage([]);
          baseRevision.current = campaign.revision;
          baseNotesRevision.current = campaign.notesRevision;
          setError('');
          setFeedback('Loaded current journal; unsaved edits discarded.');
        }}
      >
        Reload current journal
      </button>
      <div className="panel stack">
        <Field label="Personal notes" hint="Private notes are not sent to the GM.">
          <textarea rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <button
          onClick={() =>
            void save(`/campaigns/${campaign.id}/notes`, {
              notes,
              notesRevision: baseNotesRevision.current,
            })
          }
        >
          Save notes
        </button>
      </div>
      {active && (
        <JournalKnowledge
          campaignId={campaign.id}
          revision={campaign.revision}
          options={options}
          initialEntryId={initialEntryId}
          onChanged={() => void onSaved()}
        />
      )}
      <div className="panel stack">
        <h3>Campaign memory</h3>
        <MemoryText
          text={
            campaign.memory?.valid ? campaign.memory.text : 'No campaign memory checkpoint yet.'
          }
        />
        <small className="muted">
          Memory is a compact record; character state is saved separately. Full turns remain in your
          transcript.
        </small>
      </div>

      <details className="panel" hidden>
        <summary>Advanced: replace campaign memory</summary>
        <div className="stack">
          <p>
            Only confirm events you have read. This checkpoint replaces the covered transcript in
            future prompts.
          </p>
          <Field label="Replacement memory">
            <textarea rows={6} value={memory} onChange={(e) => setMemory(e.target.value)} />
          </Field>
          <fieldset>
            <legend>Covered completed turns (consecutive prefix required)</legend>
            {campaign.turns
              .filter((t) => isCompleted(t, options) && !t.undone)
              .map((t) => (
                <label className="check" key={t.id}>
                  <input
                    type="checkbox"
                    checked={coverage.includes(t.id)}
                    onChange={(e) =>
                      setCoverage(
                        e.target.checked
                          ? [...coverage, t.id]
                          : coverage.filter((id) => id !== t.id)
                      )
                    }
                  />
                  {t.action}
                </label>
              ))}
          </fieldset>
          <button
            disabled={!memory.trim() || !coverage.length}
            onClick={async () => {
              if (!confirm('Confirm that the memory accurately covers every selected turn?'))
                return;
              try {
                await request(
                  `/campaigns/${campaign.id}/memory`,
                  json('POST', {
                    revision: campaign.revision,
                    text: memory,
                    coveredTurnIds: campaign.turns
                      .filter(
                        (t) => isCompleted(t, options) && !t.undone && coverage.includes(t.id)
                      )
                      .map((t) => t.id),
                    confirm: true,
                  })
                );
                await onSaved();
                setError('');
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          >
            Confirm memory checkpoint
          </button>
        </div>
      </details>
      <details
        className="panel"
        hidden
        onToggle={(event) => setInspectOpen(event.currentTarget.open)}
      >
        <summary>Advanced: inspect last turn context (may reveal GM secrets)</summary>
        <p className="muted">
          Full saved prompts and source receipts may contain unrevealed GM information. Campaign
          exports and local logs may also contain spoilers.
        </p>
        {inspectOpen && inspectedTurn ? (
          <TurnContext
            key={`${campaign.id}:${inspectedTurn.id}`}
            campaignId={campaign.id}
            turnId={inspectedTurn.id}
          />
        ) : !inspectedTurn ? (
          <pre className="code">{'{}'}</pre>
        ) : null}
      </details>
    </section>
  );
}

function MemoryText({ text }: { text: string }) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length && lines.every((line) => /^[-*•]\s+\S/.test(line)))
    return (
      <ul className="prose">
        {lines.map((line, index) => (
          <li key={index}>{line.replace(/^[-*•]\s+/, '')}</li>
        ))}
      </ul>
    );
  return <p className="prose">{text}</p>;
}

function TurnContext({ campaignId, turnId }: { campaignId: string; turnId: string }) {
  const context = useResource<Record<string, unknown> | null>(
    `/campaigns/${campaignId}/turns/${turnId}/context`
  );
  return (
    <div>
      {context.loading && <p role="status">Loading saved context…</p>}
      <ErrorNotice message={context.error} />
      {context.error && <button onClick={() => void context.reload()}>Retry context load</button>}
      {!context.loading && !context.error && (
        <pre className="code">{JSON.stringify(context.data ?? {}, null, 2)}</pre>
      )}
    </div>
  );
}
