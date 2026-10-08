import { isCompleted } from '../../services/options';
import { useId, useRef, useState } from 'react';
import type { CampaignDetail, Settings } from '../../services/types';
import { Field, ErrorNotice } from '../../components/Controls';
import { request, json, errorMessage } from '../../services/client';
import { useResource } from '../../hooks/useResource';
import JournalKnowledge from './JournalKnowledge';
import MemoryRebuild from './MemoryRebuild';
import { MemoryText } from './MemoryText';
import HistoryMemory from './HistoryMemory';
import Advancement from '../advancement/Advancement';
const JOURNAL_TABS = [
  { id: 'notes', label: 'Personal notes' },
  { id: 'knowledge', label: 'Campaign knowledge' },
  { id: 'memory', label: 'Campaign memory' },
  { id: 'history', label: 'History recall' },
  { id: 'advancement', label: 'Advancement' },
] as const;
type JournalTab = (typeof JOURNAL_TABS)[number]['id'];

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
  const tabId = useId();
  const [tab, setTab] = useState<JournalTab>(initialEntryId ? 'knowledge' : 'notes');
  const [entryTarget, setEntryTarget] = useState(initialEntryId);
  if (entryTarget !== initialEntryId) {
    setEntryTarget(initialEntryId);
    if (initialEntryId) setTab('knowledge');
  }
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
      {active && options?.advancement && (
        <div
          role="tabpanel"
          id={`${tabId}-panel-advancement`}
          aria-labelledby={`${tabId}-tab-advancement`}
          hidden={tab !== 'advancement'}
        >
          <Advancement key={campaign.id} campaign={campaign} options={options} onSaved={onSaved} />
        </div>
      )}
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
      <div className="tabs" role="tablist" aria-label="Journal sections">
        {JOURNAL_TABS.map(({ id, label }, index) => (
          <button
            key={id}
            id={`${tabId}-tab-${id}`}
            role="tab"
            aria-selected={tab === id}
            aria-controls={`${tabId}-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            className={tab === id ? 'selected' : ''}
            onClick={() => setTab(id)}
            onKeyDown={(event) => {
              let next: number;
              if (event.key === 'ArrowRight') next = (index + 1) % JOURNAL_TABS.length;
              else if (event.key === 'ArrowLeft')
                next = (index + JOURNAL_TABS.length - 1) % JOURNAL_TABS.length;
              else if (event.key === 'Home') next = 0;
              else if (event.key === 'End') next = JOURNAL_TABS.length - 1;
              else return;
              event.preventDefault();
              const nextTab = JOURNAL_TABS[next]!.id;
              setTab(nextTab);
              document.getElementById(`${tabId}-tab-${nextTab}`)?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        className="panel stack"
        role="tabpanel"
        id={`${tabId}-panel-notes`}
        aria-labelledby={`${tabId}-tab-notes`}
        hidden={tab !== 'notes'}
        tabIndex={0}
      >
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
      <div
        role="tabpanel"
        id={`${tabId}-panel-knowledge`}
        aria-labelledby={`${tabId}-tab-knowledge`}
        hidden={tab !== 'knowledge'}
        tabIndex={0}
      >
        {active && (
          <JournalKnowledge
            campaignId={campaign.id}
            revision={campaign.revision}
            options={options}
            initialEntryId={initialEntryId}
            onChanged={() => void onSaved()}
          />
        )}
      </div>
      <div
        className="stack"
        role="tabpanel"
        id={`${tabId}-panel-memory`}
        aria-labelledby={`${tabId}-tab-memory`}
        hidden={tab !== 'memory'}
        tabIndex={0}
      >
        <div className="panel stack">
          <h3>Campaign memory</h3>
          <MemoryText
            text={
              campaign.memory?.valid ? campaign.memory.text : 'No campaign memory checkpoint yet.'
            }
          />
          <small className="muted">
            Memory is a compact record; character state is saved separately. Full turns remain in
            your transcript.
          </small>
          <MemoryRebuild
            campaignId={campaign.id}
            options={options}
            active={active}
            onApplied={onSaved}
          />
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
      </div>
      <div
        role="tabpanel"
        id={`${tabId}-panel-history`}
        aria-labelledby={`${tabId}-tab-history`}
        hidden={tab !== 'history'}
        tabIndex={0}
      >
        <HistoryMemory campaign={campaign} options={options} active={active} onChanged={onSaved} />
      </div>
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
