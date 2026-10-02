import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useResource } from '../../hooks/useResource';
import { request, json, errorMessage } from '../../services/client';
import { Field, ErrorNotice } from '../../components/Controls';
import type { RuleSystemMetadata, RuleImportPreview, RuleContext } from '../../services/types';
import RuleBrowser from './RuleBrowser';
import RuleBackup from './RuleBackup';
function Editor({ initial }: { initial: RuleSystemMetadata }) {
  const [system, setSystem] = useState(initial);
  const [instructions, setInstructions] = useState(initial.instructions);
  const [instructionRevision, setInstructionRevision] = useState(initial.revision);
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<RuleImportPreview | null>(null);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const generation = useRef(0);
  const saveIdentity = useRef<{ revision: number; instructions: string; requestId: string } | null>(
    null
  );
  const confirmIdentity = useRef<{ revision: number; requestId: string; previewId: string } | null>(
    null
  );
  useEffect(
    () => () => {
      generation.current++;
    },
    []
  );
  async function perform(operation: () => Promise<void>) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError('');
    setFeedback('');
    const current = generation.current;
    try {
      await operation();
    } catch (error) {
      if (current === generation.current) setError(errorMessage(error));
    } finally {
      if (current === generation.current) {
        guard.current = false;
        setBusy(false);
      }
    }
  }
  async function save() {
    if (new TextEncoder().encode(instructions).byteLength > system.limits.instructionsBytes)
      throw new Error('Instructions exceed the allowed UTF-8 byte limit.');
    const identity = saveIdentity.current;
    if (
      !identity ||
      identity.instructions !== instructions ||
      identity.revision !== instructionRevision
    )
      saveIdentity.current = {
        revision: instructionRevision,
        instructions,
        requestId: crypto.randomUUID(),
      };
    const current = generation.current;
    const result = await request<RuleContext>(
      `/rule-systems/${system.systemId}/instructions`,
      json('PATCH', saveIdentity.current)
    );
    if (current !== generation.current) return;
    setSystem({ ...system, ...result, instructions });
    setInstructionRevision(result.revision);
    saveIdentity.current = null;
    setFeedback('Instructions saved.');
  }
  async function importPreview() {
    if (
      files.length > system.limits.importFiles ||
      files.some((file) => file.size > system.limits.importFileBytes) ||
      files.reduce((sum, file) => sum + file.size, 0) > system.limits.importBytes
    )
      throw new Error('Book package exceeds the allowed file or byte limits.');
    const data = new FormData();
    data.set('revision', String(system.revision));
    for (const file of files) data.append('files', file);
    const current = generation.current;
    const result = await request<RuleImportPreview>(`/rule-systems/${system.systemId}/imports`, {
      method: 'POST',
      body: data,
    });
    if (current !== generation.current) return;
    setPreview(result);
    confirmIdentity.current = {
      revision: system.revision,
      previewId: result.previewId,
      requestId: crypto.randomUUID(),
    };
  }
  async function publish() {
    const identity = confirmIdentity.current;
    if (!identity) return;
    const current = generation.current;
    await request(
      `/rule-systems/${system.systemId}/imports/${identity.previewId}/confirm`,
      json('POST', { revision: identity.revision, requestId: identity.requestId })
    );
    const updated = await request<RuleSystemMetadata>(`/rule-systems/${system.systemId}`);
    if (current !== generation.current) return;
    setSystem(updated);
    setPreview(null);
    confirmIdentity.current = null;
    if (instructions === system.instructions) setInstructionRevision(updated.revision);
    setFeedback('Book published. Campaigns use the latest rules on their next new action.');
  }
  return (
    <div className="page">
      <Link to="/rules">Rules library</Link>
      <h1>{system.systemName}</h1>
      <p>Revision {system.revision}. Books provide rules; instructions guide GM behavior.</p>
      <ErrorNotice message={error} />
      {feedback && <p role="status">{feedback}</p>}
      <section className="panel">
        <h2>Instructions</h2>
        <Field label="GM instructions">
          <textarea
            aria-label="GM instructions"
            rows={6}
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
          />
        </Field>
        <button disabled={busy} onClick={() => void perform(save)}>
          Save instructions
        </button>
        <button
          disabled={busy}
          onClick={() => {
            setInstructions(system.instructions);
            setInstructionRevision(system.revision);
          }}
        >
          Reload saved instructions
        </button>
      </section>
      {!system.booksAllowed ? (
        <p>
          This protected default uses model knowledge and campaign memory. Only its instructions are
          editable.
        </p>
      ) : (
        <section className="panel">
          <h2>Books / Import</h2>
          {system.sources.map((source) => (
            <p key={source.slug}>
              {source.title} ({source.pageCount} PDF pages; PDF hash{' '}
              {source.pdfHash ? 'declared' : 'unknown'})
            </p>
          ))}
          <p>
            Select manifest.json and exactly its listed Markdown files. Import replaces that
            complete book; other books and instructions remain.
          </p>
          <Field label="Book package files">
            <input
              type="file"
              multiple
              accept=".json,.md"
              disabled={busy}
              onChange={(event) => {
                setFiles(Array.from(event.target.files ?? []));
                setPreview(null);
                confirmIdentity.current = null;
              }}
            />
          </Field>
          <button disabled={busy || !files.length} onClick={() => void perform(importPreview)}>
            Preview import
          </button>
          {preview && (
            <div>
              <h3>Preview: {preview.source.title}</h3>
              <p>
                {preview.nodeCount} nodes;{' '}
                {preview.replacing ? 'replaces this book' : 'adds this book'}.
              </p>
              <p>{preview.coverage.description}</p>
              {[...preview.warnings, ...preview.coverage.omissions].map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
              <p>Expires {new Date(preview.expiresAt).toLocaleString()}.</p>
              <button disabled={busy} onClick={() => void perform(publish)}>
                Publish book
              </button>
            </div>
          )}
        </section>
      )}
      <RuleBrowser key={`${system.systemId}:${system.revision}`} system={system} />
      <RuleBackup
        systemId={system.systemId}
        maxBytes={system.limits.backupBytes}
        onRestored={async (context) => {
          if (context.systemId !== system.systemId) return;
          const current = generation.current;
          const updated = await request<RuleSystemMetadata>(`/rule-systems/${system.systemId}`);
          if (current !== generation.current) return;
          setSystem(updated);
          if (instructions === system.instructions) {
            setInstructions(updated.instructions);
            setInstructionRevision(updated.revision);
          }
        }}
      />
    </div>
  );
}
export default function RuleSystemEditor({ id }: { id: string }) {
  const resource = useResource<RuleSystemMetadata>(`/rule-systems/${id}`);
  if (resource.loading) return <p role="status">Loading rule system…</p>;
  if (!resource.data) return <ErrorNotice message={resource.error} />;
  return <Editor key={id} initial={resource.data} />;
}
