import { isCompleted, isConfirmed } from '../../services/options';
import { useRef, useState } from 'react';
import type { CampaignDetail, Settings } from '../../services/types';
import { Field, ErrorNotice, JsonEditor } from '../../components/Controls';
import { parseObject } from '../../services/validation';
import { request, json, errorMessage } from '../../services/client';
import { useResource } from '../../hooks/useResource';
export default function Journal({
  campaign,
  onSaved,
  options,
}: {
  campaign: CampaignDetail;
  onSaved: () => Promise<void>;
  options: Settings | null;
}) {
  const baseRevision = useRef(campaign.revision),
    baseNotesRevision = useRef(campaign.notesRevision),
    savingGuard = useRef(false);
  const [feedback, setFeedback] = useState('');
  const [inspectOpen, setInspectOpen] = useState(false);
  const inspectedTurn = [...campaign.turns].reverse().find((turn) => turn.context);
  const [notes, setNotes] = useState(campaign.notes),
    [campaignName, setCampaignName] = useState(campaign.name),
    [description, setDescription] = useState(campaign.description),
    [stateJson, setStateJson] = useState(JSON.stringify(campaign.state, null, 2)),
    [pins, setPins] = useState(campaign.pinnedFacts.join('\n')),
    [pinnedSources, setPinnedSources] = useState(campaign.pinnedSourceIds),
    [instructions, setInstructions] = useState(campaign.instructions),
    [budgets, setBudgets] = useState(campaign.budgets),
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
          setCampaignName(campaign.name);
          setDescription(campaign.description);
          setStateJson(JSON.stringify(campaign.state, null, 2));
          setPins(campaign.pinnedFacts.join('\n'));
          setPinnedSources(campaign.pinnedSourceIds);
          setInstructions(campaign.instructions);
          setBudgets(campaign.budgets);
          baseRevision.current = campaign.revision;
          baseNotesRevision.current = campaign.notesRevision;
          setError('');
          setFeedback('Loaded current journal; unsaved edits discarded.');
        }}
      >
        Reload current journal
      </button>
      <div className="panel stack">
        <h3>Campaign memory</h3>
        <p className="prose">
          {campaign.memory?.valid ? campaign.memory.text : 'No campaign memory checkpoint yet.'}
        </p>
        <small className="muted">
          Memory is a compact record; character state is saved separately. Full turns remain in your
          transcript.
        </small>
      </div>
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
      <div className="panel stack">
        <Field label="Campaign name">
          <input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} />
        </Field>
        <Field label="Description">
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field
          label="Pinned campaign facts"
          hint="One per line. These facts are included in every game turn."
        >
          <textarea rows={5} value={pins} onChange={(e) => setPins(e.target.value)} />
        </Field>
        <Field label="GM instructions">
          <textarea
            rows={4}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </Field>
        <h3>Context budgets</h3>
        <fieldset>
          <legend>Pinned source material</legend>
          {campaign.sources
            .filter((s) => isConfirmed(s, options))
            .map((s) => (
              <label className="check" key={s.id}>
                <input
                  type="checkbox"
                  checked={pinnedSources.includes(s.id)}
                  onChange={(e) =>
                    setPinnedSources((current) =>
                      e.target.checked ? [...current, s.id] : current.filter((id) => id !== s.id)
                    )
                  }
                />
                {s.name}
              </label>
            ))}
          <small>
            Only pin essential short sources. Pinned content must fit the mandatory context budget.
          </small>
        </fieldset>
        {(['gameplay', 'compaction', 'memory'] as const).map((key) => (
          <Field label={`${key[0].toUpperCase() + key.slice(1)} tokens`} key={key}>
            <input
              type="number"
              min={256}
              max={options?.defaults.budgets[key]}
              value={budgets[key]}
              onChange={(e) => setBudgets({ ...budgets, [key]: Number(e.target.value) })}
            />
          </Field>
        ))}
        <button
          onClick={() =>
            void save(`/campaigns/${campaign.id}`, {
              revision: baseRevision.current,
              name: campaignName,
              description,
              pinnedFacts: pins
                .split('\n')
                .map((p) => p.trim())
                .filter(Boolean),
              instructions,
              pinnedSourceIds: pinnedSources,
              budgets,
            })
          }
        >
          Save context settings
        </button>
      </div>
      <details className="panel">
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
      <details className="panel" onToggle={(event) => setInspectOpen(event.currentTarget.open)}>
        <summary>Inspect last turn context</summary>
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
      <section className="panel stack">
        <h3>GM auxiliary state</h3>
        <dl className="sheet-values">
          {Object.entries(campaign.state).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd>
            </div>
          ))}
        </dl>
        <JsonEditor
          value={stateJson}
          onChange={setStateJson}
          label="Advanced: edit GM state JSON"
        />
        <button
          onClick={() => {
            try {
              void save(`/campaigns/${campaign.id}`, {
                revision: baseRevision.current,
                state: parseObject(stateJson),
              });
            } catch (e) {
              setError(errorMessage(e));
            }
          }}
        >
          Save GM state
        </button>
      </section>
    </section>
  );
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
