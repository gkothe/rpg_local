import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { request, json, errorMessage } from '../../services/client';
import type { RuleContext } from '../../services/types';
import { ErrorNotice } from '../../components/Controls';
type RestorePreview = {
  previewId: string;
  systemId: string;
  systemKey: string;
  systemName: string;
  contentHash: string;
  revision: number | null;
  replacing: boolean;
  protectedDefault: boolean;
  books: number;
  expiresAt: string;
  warnings: string[];
};
export default function RuleBackup({
  systemId,
  maxBytes,
  onRestored,
}: {
  systemId: string;
  maxBytes: number;
  onRestored: (context: RuleContext) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [restored, setRestored] = useState<RuleContext | null>(null);
  const guard = useRef(false);
  const generation = useRef(0);
  const identity = useRef<{ previewId: string; requestId: string; replace: boolean } | null>(null);
  useEffect(
    () => () => {
      generation.current++;
    },
    []
  );
  async function perform(operation: (current: number) => Promise<void>) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError('');
    const current = generation.current;
    try {
      await operation(current);
    } catch (error) {
      if (current === generation.current) setError(errorMessage(error));
    } finally {
      guard.current = false;
      if (current === generation.current) setBusy(false);
    }
  }
  return (
    <section className="panel stack rule-backup" aria-label="Private library backups">
      <h2>Private library backup</h2>
      <p>
        Campaign saves contain references and short evidence. This separate backup contains all
        current instructions and original book text. Keep it private.
      </p>
      <ErrorNotice message={error} />
      {feedback && <p role="status">{feedback}</p>}
      <button
        disabled={busy}
        onClick={() =>
          void perform(async () => {
            const backup = await request(`/rule-systems/${systemId}/backups`);
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(backup)], { type: 'application/json' })
            );
            const link = document.createElement('a');
            link.href = url;
            link.download = `private-rules-${systemId}.json`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          })
        }
      >
        Download private backup
      </button>
      <label className="field">
        <span>Private backup file</span>
        <input
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setPreview(null);
            setReplace(false);
            identity.current = null;
          }}
        />
      </label>
      <button
        disabled={busy || !file}
        onClick={() =>
          void perform(async (current) => {
            if (!file) return;
            if (file.size > maxBytes)
              throw new Error('Private backup exceeds the server byte limit');
            const body = new FormData();
            body.append('file', file);
            const next = await request<RestorePreview>('/rule-systems/backups/imports', {
              method: 'POST',
              body,
            });
            if (current !== generation.current) return;
            setPreview(next);
            setReplace(false);
            identity.current = null;
            setFeedback('');
          })
        }
      >
        Preview private restore
      </button>
      {preview && (
        <div className="stack">
          <h3>Restore {preview.systemName}</h3>
          <p>
            {preview.books} books · hash {preview.contentHash} ·{' '}
            {preview.replacing
              ? `replaces local revision ${preview.revision}`
              : 'creates a local system'}
            .
          </p>
          {preview.protectedDefault && (
            <p>The protected default retains its local identity and restores instructions only.</p>
          )}
          {preview.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
          <p>Preview expires {new Date(preview.expiresAt).toLocaleString()}.</p>
          {preview.replacing && (
            <label className="check">
              <input
                type="checkbox"
                disabled={busy}
                checked={replace}
                onChange={(event) => {
                  setReplace(event.target.checked);
                  identity.current = null;
                }}
              />
              Explicitly replace this existing system
            </label>
          )}
          <button
            disabled={busy || (preview.replacing && !replace)}
            onClick={() =>
              void perform(async (current) => {
                identity.current ??= {
                  previewId: preview.previewId,
                  requestId: crypto.randomUUID(),
                  replace,
                };
                const result = await request<RuleContext>(
                  `/rule-systems/backups/imports/${identity.current.previewId}/confirm`,
                  json('POST', {
                    systemId: preview.systemId,
                    systemKey: preview.systemKey,
                    revision: preview.revision,
                    requestId: identity.current.requestId,
                    replace: identity.current.replace,
                  })
                );
                if (current !== generation.current) return;
                setRestored(result);
                setPreview(null);
                setFeedback(
                  'Private library restored. Resolve missing campaign references explicitly from the campaign rule selection.'
                );
                await onRestored(result);
              })
            }
          >
            Confirm private restore
          </button>
        </div>
      )}
      {restored && <Link to={`/rules/${restored.systemId}`}>Open restored library</Link>}
    </section>
  );
}
