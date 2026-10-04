import { useEffect, useRef, useState } from 'react';
import type { Campaign, Source, Settings } from '../../services/types';
import { Field, ErrorNotice } from '../../components/Controls';
import { request, json, errorMessage } from '../../services/client';
import { SourceSections } from './SourceSections';
import { isConfirmed } from '../../services/options';
import { uploadSources } from './uploadSources';
export default function SourceManager({
  campaign,
  onSaved,
  options,
}: {
  campaign: Campaign;
  onSaved: () => Promise<void>;
  options: Settings | null;
}) {
  const savingGuard = useRef(false),
    previewRevision = useRef(campaign.revision),
    current = useRef(true);
  useEffect(() => {
    current.current = true;
    return () => {
      current.current = false;
    };
  }, [campaign.id]);
  const [name, setName] = useState(''),
    [adding, setAdding] = useState(false),
    [text, setText] = useState(''),
    [url, setUrl] = useState(''),
    [language, setLanguage] = useState(''),
    [purpose, setPurpose] = useState(''),
    [editPurpose, setEditPurpose] = useState(''),
    [files, setFiles] = useState<File[]>([]),
    [progress, setProgress] = useState(''),
    [selected, setSelected] = useState<Source | null>(null),
    [edit, setEdit] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const currentSource = selected && campaign.sources.find((source) => source.id === selected.id);
  async function run(fn: () => Promise<unknown>) {
    if (savingGuard.current) return;
    savingGuard.current = true;
    setBusy(true);
    setError('');
    try {
      await fn();
      if (current.current) await onSaved();
    } catch (e) {
      if (current.current) setError(errorMessage(e));
    } finally {
      savingGuard.current = false;
      if (current.current) setBusy(false);
    }
  }
  return (
    <section className="stack">
      <ErrorNotice message={error} />
      <div hidden={adding} className="stack">
        <h2>Rules & source material</h2>
        <p className="muted">
          Imported documents are ready for the GM immediately. Reviewing and correcting extracted
          text is optional.
        </p>
        <button type="button" onClick={() => setAdding(true)}>
          Add source
        </button>
        {campaign.sources.map((s) => (
          <div className="source-row" key={s.id}>
            <div>
              <strong>{s.name}</strong>
              <small>
                {s.kind} · {s.status} · version {s.version}
              </small>
            </div>
            <button
              disabled={busy}
              onClick={() => {
                setSelected(s);
                setEditPurpose(
                  s.purpose ||
                    options?.sourcePurposeOptions?.find((option) => option.default)?.id ||
                    ''
                );
                previewRevision.current = campaign.revision;
                setEdit(s.text);
              }}
            >
              {isConfirmed(s, options) ? 'View / edit text' : 'Review text'}
            </button>
          </div>
        ))}
        {selected && (
          <div className="panel stack">
            <h3>Review: {selected.name}</h3>
            {selected.originalAvailable ? (
              <a
                className="button"
                href={`/api/campaigns/${campaign.id}/sources/${selected.id}/original`}
                target="_blank"
                rel="noreferrer"
              >
                Open original document
              </a>
            ) : (
              <small className="muted">
                No original binary is retained for this source. Confirmed text remains usable and
                portable.
              </small>
            )}
            {selected.pages.length > 0 && (
              <details>
                <summary>Original extraction pages & confidence</summary>
                <p className="muted">
                  This is the initial extraction for comparison. Edited text below becomes the
                  authoritative source when confirmed.
                </p>
                {selected.pages.map((page, index) => (
                  <article key={index} className="source-section">
                    <h4>Page {index + 1}</h4>
                    <dl className="sheet-values">
                      {Object.entries(page).map(([key, value]) => (
                        <div key={key}>
                          <dt>{key}</dt>
                          <dd>
                            {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </article>
                ))}
              </details>
            )}
            {selected.warnings.map((w, i) => (
              <p className="notice" key={i}>
                {w}
              </p>
            ))}
            <Field label="Extracted text">
              <textarea rows={12} value={edit} onChange={(e) => setEdit(e.target.value)} />
            </Field>
            {options?.sourcePurposeOptions && (
              <Field label="Source purpose">
                <select
                  value={editPurpose}
                  onChange={(event) => setEditPurpose(event.target.value)}
                  disabled={busy}
                >
                  {options.sourcePurposeOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {currentSource && isConfirmed(currentSource, options) && (
              <SourceSections
                key={`${currentSource.id}:${currentSource.version}`}
                campaign={campaign}
                source={currentSource}
                onSaved={onSaved}
              />
            )}
            <div className="row wrap">
              <button
                className="primary"
                disabled={busy || !edit.trim()}
                onClick={() =>
                  void run(async () => {
                    await request(
                      `/campaigns/${campaign.id}/sources/${selected.id}`,
                      json('PATCH', {
                        revision: previewRevision.current,
                        text: edit,
                        confirmed: true,
                        purpose:
                          editPurpose ||
                          selected.purpose ||
                          options?.sourcePurposeOptions?.find((option) => option.default)?.id,
                      })
                    );
                    setSelected(null);
                  })
                }
              >
                Confirm corrected text
              </button>
              <button onClick={() => setSelected(null)}>Close preview</button>
              <button
                className="danger"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await request(
                      `/campaigns/${campaign.id}/sources/${selected.id}`,
                      json('DELETE', { revision: campaign.revision })
                    );
                    setSelected(null);
                  })
                }
              >
                Delete source
              </button>
            </div>
          </div>
        )}
      </div>
      <section className="panel stack" hidden={!adding} aria-label="Add source">
        <button type="button" disabled={busy} onClick={() => setAdding(false)}>
          Back to sources
        </button>
        <h2>Add source</h2>
        <div className="stack">
          {options?.sourcePurposeOptions && (
            <Field label="Source purpose">
              <select
                value={
                  purpose || options.sourcePurposeOptions.find((option) => option.default)?.id || ''
                }
                onChange={(event) => setPurpose(event.target.value)}
                disabled={busy}
              >
                {options.sourcePurposeOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Source name">
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Paste rules or source text">
            <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <button
            disabled={busy || !text.trim() || !name.trim()}
            onClick={() =>
              void run(async () => {
                await request(
                  `/campaigns/${campaign.id}/sources`,
                  json('POST', {
                    revision: campaign.revision,
                    name,
                    text,
                    purpose:
                      purpose ||
                      options?.sourcePurposeOptions?.find((option) => option.default)?.id,
                  })
                );
                setText('');
              })
            }
          >
            Add pasted text
          </button>
          <hr />
          <Field label="OCR language">
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="">Default language</option>
              {options?.ocrLanguageOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Markdown, text or PDF files (select multiple)">
            <input
              disabled={busy}
              type="file"
              multiple
              accept="text/*,.txt,.md,.markdown,.json,.yaml,.yml,.csv,.pdf,application/json"
              onChange={(e) => {
                setFiles(Array.from(e.target.files || []));
                setProgress('');
                e.target.value = '';
              }}
            />
          </Field>
          <small className="muted">
            Any UTF-8 text format is supported, including JSON and YAML. Files are imported one at a
            time and are ready to use immediately. Reviewing text is optional. Scanned PDFs use the
            configured local OCR runtime.
          </small>
          {files.length > 0 && (
            <ul>
              {files.map((file, index) => (
                <li key={index}>{file.name}</li>
              ))}
            </ul>
          )}
          <button
            disabled={busy || !files.length || !options}
            onClick={() =>
              void run(async () => {
                if (!options) return;
                const result = await uploadSources(
                  campaign,
                  files,
                  language || options.defaults.ocrLanguage,
                  options.limits.uploadBytes,
                  (message) => {
                    if (current.current) setProgress(message);
                  },
                  () => current.current,
                  purpose || options.sourcePurposeOptions?.find((option) => option.default)?.id
                );
                if (!current.current) return;
                setFiles(result.remaining);
                setProgress(`${result.imported.length} file(s) imported and ready to use.`);
                setError(result.error);
              })
            }
          >
            Import selected files
          </button>
          {progress && <p role="status">{progress}</p>}
          <hr />
          <Field label="Public Google Docs URL">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://docs.google.com/document/d/…"
            />
          </Field>
          <button
            disabled={busy || !url}
            onClick={() =>
              void run(async () => {
                await request(
                  `/campaigns/${campaign.id}/sources/extract`,
                  json('POST', {
                    revision: campaign.revision,
                    url,
                    name: name || undefined,
                    purpose:
                      purpose ||
                      options?.sourcePurposeOptions?.find((option) => option.default)?.id,
                  })
                );
                setUrl('');
              })
            }
          >
            Import Google Doc
          </button>
          {busy && <p role="status">Processing source…</p>}
        </div>
      </section>
    </section>
  );
}
