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
      ? 'Committed: Mira HP 10 → 9; snapshot and completed narrative save together.'
      : outcome === 'undo'
        ? conflict
          ? 'Undo blocked: a touched attributes field changed later. The app refuses to overwrite it.'
          : 'Undone: Mira HP 9 → 10; the turn remains in audit history.'
        : 'No gameplay commit: HP remains 10. Tool audit and any earlier committed memory milestones can survive.';
  return (
    <section className="flow-card" aria-label="Storage explorer">
      <h2>What persists, and when?</h2>
      <p>
        PostgreSQL stores canonical data and audit records. Extraction and model inference run
        outside the final gameplay transaction. Disk artifacts, provider authentication and
        in-memory snapshots have different lifetimes.
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
        <li>Submit → turn identity and frozen session recorded.</li>
        <li>Optional compaction → memory milestone may commit before gameplay.</li>
        <li>Tool loop → dice persisted before reveal; rule-read receipts persisted.</li>
        <li>
          {outcome === 'success' || outcome === 'undo'
            ? 'Validate → atomic campaign, snapshot and narrative commit.'
            : 'Stop → no final canonical update.'}
        </li>
        {outcome === 'undo' && (
          <li>Undo → compare touched fields and restore only their previous values.</li>
        )}
      </ol>
      <p className="flow-notice" role="status">
        {status}
      </p>
      <p>
        Dice and rule-read audit retained when those tools ran; they are not rolled back by a
        rejected proposal or undo.
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
              ? 'State restoration also requires the touched campaign state to match the snapshot’s after value.'
              : 'This turn did not touch state: undo preserves a later location/state edit.'}{' '}
            Unrelated character edits and private notes remain. A newly created NPC with later
            private notes can block its removal.
          </p>
          <p>
            Memory covering the undone turn becomes invalid; prior valid memory can be restored. The
            completed turn is marked undone, never erased.
          </p>
        </>
      )}
      <details>
        <summary>Recovery and explicit retry</summary>
        <p>
          A heartbeat renews only an owned, unchanged turn. Recovery marks expired leases
          interrupted; it does not call the model. An explicit eligible retry creates a new TurnID
          and reuses the unchanged original frozen session and matching dice specification. Imported
          sessions cannot be executed.
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
