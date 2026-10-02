import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Field, ErrorNotice } from '../components/Controls';
import { useResource } from '../hooks/useResource';
import ProviderPicker from '../features/providers/ProviderPicker';
import RuleSystemPicker from '../features/rules/RuleSystemPicker';
import type { Campaign, Provider, ProviderSettings, Settings } from '../services/types';
import { request, json, errorMessage } from '../services/client';
import { uploadSources } from '../features/sources/uploadSources';
export default function Setup() {
  const savingGuard = useRef(false);
  const current = useRef(true);
  const created = useRef<Campaign | null>(null);
  const options = useResource<Settings>('/settings');
  const [campaignFiles, setCampaignFiles] = useState<File[]>([]);
  const [characterFile, setCharacterFile] = useState<File | null>(null);
  const [campaignUrl, setCampaignUrl] = useState('');
  const [characterUrl, setCharacterUrl] = useState('');
  const [language, setLanguage] = useState('');
  const [progress, setProgress] = useState('');
  useEffect(() => {
    current.current = true;
    return () => {
      current.current = false;
    };
  }, []);
  const providers = useResource<Provider[]>('/providers'),
    [name, setName] = useState(''),
    [description, setDescription] = useState(''),
    [instructions, setInstructions] = useState(''),
    [ruleSystemId, setRuleSystemId] = useState<string | null>(null),
    [settings, setSettings] = useState<ProviderSettings>({ provider: '', model: '', effort: null }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const navigate = useNavigate();
  return (
    <div className="page narrow">
      <Link className="back" to="/">
        Back to library
      </Link>
      <p className="eyebrow">A fresh beginning</p>
      <h1>New campaign</h1>
      <p className="muted">
        Start with the essentials. Add rules, import a character sheet, and review sources before
        playing.
      </p>
      <form
        className="panel form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (savingGuard.current || created.current) return;
          savingGuard.current = true;
          setBusy(true);
          setError('');
          try {
            const files = [...campaignFiles, ...(characterFile ? [characterFile] : [])];
            const urls = [campaignUrl.trim(), characterUrl.trim()].filter(Boolean);
            if ((files.length || urls.length) && !options.data) {
              throw new Error(
                'Import settings are unavailable. Refresh the page before importing.'
              );
            }
            for (const file of files) {
              if (!/\.(md|txt|pdf)$/i.test(file.name))
                throw new Error(`${file.name}: choose Markdown, text or PDF.`);
              if (options.data && file.size > options.data.limits.uploadBytes) {
                throw new Error(`${file.name}: file exceeds the configured upload limit.`);
              }
            }
            for (const url of urls) {
              const parsed = new URL(url);
              if (
                parsed.protocol !== 'https:' ||
                parsed.hostname !== 'docs.google.com' ||
                !parsed.pathname.startsWith('/document/d/')
              ) {
                throw new Error('Use a public Google Docs document link.');
              }
            }
            const c = await request<Campaign>(
              '/campaigns',
              json('POST', {
                name: name.trim(),
                description,
                instructions,
                settings,
                systemId: ruleSystemId,
              })
            );
            created.current = c;
            if (!current.current) return;
            let latest = c;
            if (files.length && options.data) {
              const result = await uploadSources(
                c,
                files,
                language || options.data.defaults.ocrLanguage,
                options.data.limits.uploadBytes,
                setProgress,
                () => current.current
              );
              latest = result.campaign;
              created.current = latest;
              if (result.error) throw new Error(result.error);
            }
            for (const url of urls) {
              if (!current.current) return;
              setProgress('Importing Google Docs document…');
              latest = await request<Campaign>(
                `/campaigns/${c.id}/sources/extract`,
                json('POST', {
                  revision: latest.revision,
                  url,
                })
              );
              created.current = latest;
            }
            if (current.current) navigate(`/campaigns/${c.id}?setup=1`);
          } catch (e) {
            if (current.current) setError(errorMessage(e));
          } finally {
            savingGuard.current = false;
            if (current.current) {
              setBusy(false);
              setProgress('');
            }
          }
        }}
      >
        <ErrorNotice message={error || providers.error} />
        {created.current && !busy && (
          <p className="notice">
            Your campaign was saved. Review its sources before retrying an import; a lost response
            may still have saved the document.{' '}
            <Link to={`/campaigns/${created.current.id}?setup=1`}>Continue to source review</Link>
          </p>
        )}
        <fieldset disabled={busy || !!created.current} className="stack setup-fields">
          <Field label="Campaign name">
            <input
              autoFocus
              required
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name your campaign"
            />
          </Field>
          <Field label="Description">
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Setting, premise, or a short description"
            />
          </Field>
          <Field
            label="GM instructions"
            hint="Your tone, gameplay language, and boundaries. You can edit these later."
          >
            <textarea
              rows={5}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Describe how you want the GM to run the game"
            />
          </Field>
          <h2>Game master</h2>
          <RuleSystemPicker value={ruleSystemId} onChange={setRuleSystemId} disabled={busy} />
          <ProviderPicker
            providers={providers.data || []}
            value={settings}
            onChange={setSettings}
            disabled={busy}
            onRefresh={() => providers.reload('/providers?refresh=true')}
          />
          <small className="muted">
            You can create and prepare a campaign before a CLI is available.
          </small>
          <section className="stack" aria-label="Campaign documents">
            <h2>Campaign documents</h2>
            <Field label="Campaign files (select multiple)">
              <input
                type="file"
                multiple
                accept=".md,.txt,.pdf"
                onChange={(e) => setCampaignFiles(Array.from(e.target.files || []))}
              />
            </Field>
            {campaignFiles.length > 0 && (
              <ul>
                {campaignFiles.map((file, index) => (
                  <li key={index}>{file.name}</li>
                ))}
              </ul>
            )}
            <Field label="Campaign public Google Docs URL">
              <input
                type="url"
                value={campaignUrl}
                onChange={(e) => setCampaignUrl(e.target.value)}
                placeholder="https://docs.google.com/document/d/…"
              />
            </Field>
            <p className="muted">
              Add your adventure, setting, background or other campaign material. Markdown, text and
              PDF files are supported, including scanned PDFs when local OCR is configured.
            </p>
          </section>
          <section className="stack" aria-label="Character sheet">
            <h2>Character sheet</h2>
            <Field label="Character sheet file">
              <input
                type="file"
                accept=".md,.txt,.pdf"
                onChange={(e) => setCharacterFile(e.target.files?.[0] || null)}
              />
            </Field>
            <Field label="Character public Google Docs URL">
              <input
                type="url"
                value={characterUrl}
                onChange={(e) => setCharacterUrl(e.target.value)}
                placeholder="https://docs.google.com/document/d/…"
              />
            </Field>
            <p className="muted">
              Imported sheets are ready to use immediately. Open Characters and choose “Parse a confirmed source” to
              generate an editable sheet. Nothing is added as a character until you approve the
              draft.
            </p>
          </section>
          {options.data && (
            <Field label="PDF OCR language">
              <select
                value={language || options.data.defaults.ocrLanguage}
                onChange={(e) => setLanguage(e.target.value)}
              >
                {options.data.ocrLanguageOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <p className="muted">
            Files are imported when you create the campaign and are ready to use immediately.
            Reviewing extracted text is optional. You can add more documents later.
          </p>
        </fieldset>
        {progress && <p role="status">{progress}</p>}
        <button className="primary" disabled={busy || !name.trim() || !!created.current}>
          {busy ? 'Creating…' : 'Create campaign'}
        </button>
      </form>
    </div>
  );
}
