import { useEffect, useRef, useState } from 'react';
import { request, json, errorMessage } from '../../services/client';
import { Field, ErrorNotice } from '../../components/Controls';
import type { SheetLayout, SheetLayoutOptions, SheetWidgetOption } from '../../services/types';

const EMPTY_LAYOUT: SheetLayout = { fields: [] };
const params = (widget: SheetWidgetOption) =>
  [
    widget.params.max &&
      `max ${widget.params.max.min}–${widget.params.max.max}${widget.params.max.required ? ' (required)' : ''}`,
    widget.params.maxPath && 'maxPath',
    widget.params.modifierPath && 'modifierPath',
  ]
    .filter(Boolean)
    .join(', ') || 'none';

export default function SheetLayoutEditor({
  systemId,
  layout,
  options,
}: {
  systemId: string;
  layout?: SheetLayout;
  options?: SheetLayoutOptions;
}) {
  const [text, setText] = useState(() => JSON.stringify(layout ?? EMPTY_LAYOUT, null, 2));
  const [saved, setSaved] = useState(layout ?? EMPTY_LAYOUT);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const identity = useRef<{ text: string; requestId: string } | null>(null);
  async function save() {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      let sheetLayout: SheetLayout;
      try {
        sheetLayout = JSON.parse(text) as SheetLayout;
      } catch {
        throw new Error('Sheet layout must be valid JSON.');
      }
      // An uncertain save retried with the same text keeps its request identity.
      if (identity.current?.text !== text)
        identity.current = { text, requestId: crypto.randomUUID() };
      const result = await request<{ sheetLayout: SheetLayout }>(
        `/rule-systems/${systemId}/sheet-layout`,
        json('PUT', { requestId: identity.current.requestId, sheetLayout })
      );
      if (!mounted.current) return;
      identity.current = null;
      setSaved(result.sheetLayout);
      setFeedback('Sheet layout saved.');
    } catch (failure) {
      if (mounted.current) setError(errorMessage(failure));
    } finally {
      guard.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <section className="panel stack" aria-label="Sheet layout">
      <h2>Sheet layout</h2>
      <p>
        Hints that tell character sheets how to draw this system&apos;s fields. They are display
        only and never change a character, the rules or what the GM sees.
      </p>
      <ErrorNotice message={error} />
      {feedback && <p role="status">{feedback}</p>}
      <Field label="Sheet layout JSON">
        <textarea
          className="code"
          rows={12}
          spellCheck={false}
          disabled={busy}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </Field>
      <div className="row wrap">
        <button disabled={busy} onClick={() => void save()}>
          Save sheet layout
        </button>
        <button
          disabled={busy}
          onClick={() => {
            setText(JSON.stringify(saved, null, 2));
            setError('');
            setFeedback('');
          }}
        >
          Reload saved layout
        </button>
      </div>
      {options && (
        <details>
          <summary>Widget reference</summary>
          <div className="table-scroll">
            <table className="widget-reference">
              <thead>
                <tr>
                  <th scope="col">Widget</th>
                  <th scope="col">Use for</th>
                  <th scope="col">Parameters</th>
                </tr>
              </thead>
              <tbody>
                {options.widgets.map((widget) => (
                  <tr key={widget.id}>
                    <th scope="row">
                      <code>{widget.id}</code>
                    </th>
                    <td>{widget.description}</td>
                    <td>{params(widget)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <small className="muted">
            Up to {options.limits.fields} fields and {options.limits.bytes} bytes; paths start with
            attributes, inventory or description.
          </small>
        </details>
      )}
    </section>
  );
}
