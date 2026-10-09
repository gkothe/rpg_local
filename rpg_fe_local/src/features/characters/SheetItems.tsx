import { useEffect, useRef, useState } from 'react';
import { Package, Pencil, Shield, Sword, Trash2, Wrench, type LucideIcon } from 'lucide-react';
import { ErrorNotice, Field } from '../../components/Controls';
import { errorMessage } from '../../services/client';
import CharacterData from './CharacterData';
import { replaceAt, type ItemDelete, type ItemSave } from './itemValues';

const ITEM_ICONS: Record<string, LucideIcon> = {
  weapon: Sword,
  shield: Shield,
  armor: Shield,
  tool: Wrench,
};
const humanize = (key: string) => key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
function ValueFields({
  value,
  label,
  onChange,
}: {
  value: unknown;
  label: string;
  onChange: (value: unknown) => void;
}) {
  if (value && typeof value === 'object') {
    return (
      <fieldset className="stack item-fields">
        <legend>{label}</legend>
        {Object.entries(value).map(([key, child]) => (
          <ValueFields
            key={key}
            label={humanize(key)}
            value={child}
            onChange={(next) => onChange(replaceAt(value, [key], next))}
          />
        ))}
      </fieldset>
    );
  }
  if (value === null)
    return (
      <Field label={label}>
        <select value="null" onChange={(e) => onChange(e.target.value === 'null' ? null : '')}>
          <option value="null">No value</option>
          <option value="text">Text</option>
        </select>
      </Field>
    );
  return (
    <Field label={label}>
      {typeof value === 'boolean' ? (
        <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      ) : typeof value === 'number' ? (
        <input
          type="number"
          step="any"
          required
          value={Number.isFinite(value) ? value : ''}
          onChange={(e) => onChange(e.target.valueAsNumber)}
        />
      ) : (
        <textarea
          rows={String(value).includes('\n') || String(value).length > 100 ? 4 : 2}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

function ItemEditor({
  item,
  onSave,
  onClose,
}: {
  item: Record<string, unknown>;
  onSave: (original: unknown, value: unknown) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const baseline = useRef<unknown>(item);
  const guard = useRef(false);
  const alive = useRef(true);
  const [draft, setDraft] = useState<unknown>(item);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  useEffect(() => {
    alive.current = true;
    dialog.current?.showModal();
    return () => {
      alive.current = false;
    };
  }, []);
  const close = () => {
    dialog.current?.close();
    onClose();
  };
  return (
    <dialog
      ref={dialog}
      className="sheet-item-dialog"
      aria-label={`Edit ${item.name}`}
      onCancel={(event) => {
        event.preventDefault();
        if (!guard.current) close();
      }}
    >
      <form
        className="stack"
        onSubmit={async (event) => {
          event.preventDefault();
          if (guard.current) return;
          guard.current = true;
          setBusy(true);
          setError('');
          setFeedback('');
          try {
            await onSave(baseline.current, draft);
            baseline.current = draft;
            if (alive.current) setFeedback('Item saved.');
          } catch (e) {
            if (alive.current) setError(errorMessage(e));
          } finally {
            guard.current = false;
            if (alive.current) setBusy(false);
          }
        }}
      >
        <h3>Edit {String(item.name)}</h3>
        <ErrorNotice message={error} />
        {feedback && <small role="status">{feedback}</small>}
        <fieldset disabled={busy} className="stack item-fields">
          <ValueFields value={draft} label="Item values" onChange={setDraft} />
        </fieldset>
        <div className="row wrap">
          <button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save item'}
          </button>
          <button type="button" disabled={busy} onClick={close}>
            Close
          </button>
        </div>
      </form>
    </dialog>
  );
}

function DeleteItemDialog({
  item,
  onDelete,
  onClose,
}: {
  item: Record<string, unknown>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const guard = useRef(false);
  const alive = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    alive.current = true;
    dialog.current?.showModal();
    return () => {
      alive.current = false;
    };
  }, []);
  const close = () => {
    dialog.current?.close();
    onClose();
  };
  return (
    <dialog
      ref={dialog}
      className="sheet-item-dialog"
      aria-label={`Delete ${item.name}`}
      onCancel={(event) => {
        event.preventDefault();
        if (!guard.current) close();
      }}
    >
      <div className="stack">
        <h3>Delete {String(item.name)}?</h3>
        <p>This will permanently remove this item from the character sheet.</p>
        <ErrorNotice message={error} />
        <div className="row wrap">
          <button type="button" autoFocus disabled={busy} onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={async () => {
              if (guard.current) return;
              guard.current = true;
              setBusy(true);
              setError('');
              try {
                await onDelete();
                if (alive.current) close();
              } catch (e) {
                if (alive.current) setError(errorMessage(e));
              } finally {
                guard.current = false;
                if (alive.current) setBusy(false);
              }
            }}
          >
            {busy ? 'Deleting…' : 'Delete item'}
          </button>
        </div>
      </div>
    </dialog>
  );
}

export default function SheetItems({
  items,
  path,
  source,
  onSave,
  onDelete,
}: {
  items: Record<string, unknown>[];
  path: string[];
  source: unknown;
  onSave?: ItemSave;
  onDelete?: ItemDelete;
}) {
  const [sortKey, setSortKey] = useState('');
  const [descending, setDescending] = useState(false);
  const [editing, setEditing] = useState<{ item: Record<string, unknown>; path: string[] } | null>(
    null
  );
  const [deleting, setDeleting] = useState<{
    item: Record<string, unknown>;
    path: string[];
  } | null>(null);
  const keys = [...new Set(items.flatMap(Object.keys))];
  const sourceKeys = source && typeof source === 'object' ? Object.keys(source) : [];
  const entries = items.map((item, index) => ({
    item,
    path: [...path, sourceKeys[index] ?? String(index)],
  }));
  if (sortKey && keys.includes(sortKey))
    entries.sort((a, b) => {
      const first = a.item[sortKey],
        second = b.item[sortKey];
      if (first == null) return second == null ? 0 : 1;
      if (second == null) return -1;
      const order =
        typeof first === 'number' && typeof second === 'number'
          ? first - second
          : String(typeof first === 'object' ? JSON.stringify(first) : first).localeCompare(
              String(typeof second === 'object' ? JSON.stringify(second) : second),
              undefined,
              { numeric: true, sensitivity: 'base' }
            );
      return descending ? -order : order;
    });
  return (
    <div className="stack">
      <div className="row wrap sheet-item-sort">
        <Field label="Sort items by">
          <select
            value={keys.includes(sortKey) ? sortKey : ''}
            onChange={(e) => setSortKey(e.target.value)}
          >
            <option value="">Original order</option>
            {keys.map((key) => (
              <option key={key} value={key}>
                {humanize(key)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Sort direction">
          <select
            disabled={!sortKey}
            value={descending ? 'descending' : 'ascending'}
            onChange={(e) => setDescending(e.target.value === 'descending')}
          >
            <option value="ascending">Ascending</option>
            <option value="descending">Descending</option>
          </select>
        </Field>
      </div>
      <ul className="sheet-items">
        {entries.map(({ item, path: itemPath }) => {
          const { name, ...rest } = item;
          const Icon = ITEM_ICONS[String(rest.type).toLowerCase()] ?? Package;
          return (
            <li key={JSON.stringify(itemPath)} className="sheet-item">
              <span className="sheet-item-icon" aria-hidden="true">
                <Icon size={22} strokeWidth={1.8} />
              </span>
              <div className="sheet-item-body">
                <strong>{String(name)}</strong>
                {Object.keys(rest).length > 0 && <CharacterData value={rest} />}
              </div>
              <div className="sheet-item-actions">
                {onSave && (
                  <button
                    type="button"
                    className="sheet-item-edit"
                    aria-label={`Edit ${name}`}
                    title={`Edit ${name}`}
                    onClick={() => setEditing({ item, path: itemPath })}
                  >
                    <Pencil size={18} aria-hidden="true" />
                  </button>
                )}
                {onDelete && (
                  <button
                    type="button"
                    className="sheet-item-delete danger"
                    aria-label={`Delete ${name}`}
                    title={`Delete ${name}`}
                    onClick={() => setDeleting({ item, path: itemPath })}
                  >
                    <Trash2 size={18} aria-hidden="true" />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {editing && onSave && (
        <ItemEditor
          item={editing.item}
          onClose={() => setEditing(null)}
          onSave={(original, value) => onSave(editing.path, original, value)}
        />
      )}
      {deleting && onDelete && (
        <DeleteItemDialog
          item={deleting.item}
          onClose={() => setDeleting(null)}
          onDelete={() => onDelete(deleting.path, deleting.item)}
        />
      )}
    </div>
  );
}
