import { useState } from 'react';
import { branches, storageItems } from './content';
export default function StorageExplorer({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [outcome, setOutcome] = useState('success'),
    [conflict, setConflict] = useState(false),
    [changedState, setChangedState] = useState(true);
  const status =
    outcome === 'success'
      ? "Committed: Mira's HP changes from 10 to 9. The app saves the snapshot and completed story together."
      : outcome === 'undo'
        ? conflict
          ? 'Undo blocked: a later edit changed the same attributes field. The app refuses to overwrite that edit.'
          : "Undone: Mira's HP returns from 9 to 10. The app keeps the turn in its history."
        : 'The app saves no gameplay change, so HP remains 10. Tool records and any summaries saved earlier can survive the failure.';
  return (
    <section className="flow-card" aria-label="Storage explorer">
      <h2>What gets saved, and when?</h2>
      <p>
        PostgreSQL stores the saved campaign and records of what happened. File extraction and model
        calls run before the final gameplay transaction. Original files on disk, provider
        authentication, and temporary copies in memory have their own lifetimes.
      </p>
      <div className="flow-storage-list">
        {storageItems.map((item) => (
          <button
            key={item.id}
            aria-pressed={selected === item.id}
            onClick={() => onSelect(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <h3 style={{ marginTop: '1.5rem' }}>Try an outcome</h3>
      <label>
        Outcome
        <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          <option value="success">Success</option>
          <option value="invalid">Invalid response</option>
          <option value="cancelled">Cancelled / interrupted</option>
          <option value="undo">Undo the completed turn</option>
        </select>
      </label>
      <ol className="flow-trace">
        <li>The app records the submitted turn and its fixed session.</li>
        <li>If it summarizes older turns, that summary may be saved before gameplay finishes.</li>
        <li>
          When tools run, dice results are saved before the model sees them, and rule reads get
          saved receipts.
        </li>
        <li>
          {outcome === 'success' || outcome === 'undo'
            ? 'After validation, the app saves campaign changes, the snapshot, and the story in one transaction.'
            : 'The attempt stops without saving gameplay changes.'}
        </li>
        {outcome === 'undo' && (
          <li>Undo checks the fields this turn changed and restores only their previous values.</li>
        )}
      </ol>
      <p className="flow-notice" role="status">
        {status}
      </p>
      <p>
        The app keeps any dice results and rule-read records already saved. A rejected proposal or
        an undo does not erase them.
      </p>
      {outcome === 'undo' && (
        <>
          <div className="flow-controls">
            <label>
              <input
                type="checkbox"
                checked={conflict}
                onChange={(e) => setConflict(e.target.checked)}
              />
              Later edit changed a touched field
            </label>
            <label>
              <input
                type="checkbox"
                checked={changedState}
                onChange={(e) => setChangedState(e.target.checked)}
              />
              Turn changed campaign state
            </label>
          </div>
          <p>
            {changedState
              ? 'To restore campaign state, the app checks that its current value still matches the value saved after this turn.'
              : 'This turn did not change campaign state, so undo leaves a later location or state edit alone.'}{' '}
            The app keeps unrelated character edits and private notes. If you added private notes to
            an NPC created by this turn, those notes can block the NPC's removal.
          </p>
          <p>
            A summary covering the undone turn becomes invalid, and the app can restore an earlier
            valid summary. The completed turn is marked undone and stays in the history.
          </p>
        </>
      )}
      <details>
        <summary>What happens after an interruption?</summary>
        <p>
          A heartbeat renews the attempt's permission to run only while it still owns the turn and
          the required versions match. Recovery marks expired turns interrupted without calling the
          model. If the attempt is eligible and you request a retry, the app creates a new turn ID
          and reuses the unchanged original session. Matching dice requests reuse their saved
          results. Imported sessions cannot run again.
        </p>
      </details>
      <h3 style={{ marginTop: '1.5rem' }}>Other paths into and out of the system</h3>
      <div className="flow-aux">
        {branches.map((branch) => (
          <details key={branch.label}>
            <summary>{branch.label}</summary>
            <p>{branch.text}</p>
            <p>Architecture document section {branch.section}.</p>
          </details>
        ))}
      </div>
    </section>
  );
}
