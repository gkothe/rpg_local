import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Field, ErrorNotice } from '../components/Controls';
import { useResource } from '../hooks/useResource';
import ProviderPicker from '../features/providers/ProviderPicker';
import RuleSystemPicker from '../features/rules/RuleSystemPicker';
import type { Campaign, Provider, ProviderSettings } from '../services/types';
import { request, json, errorMessage } from '../services/client';
export default function Setup() {
  const savingGuard = useRef(false);
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
          if (savingGuard.current) return;
          savingGuard.current = true;
          setBusy(true);
          setError('');
          try {
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
            navigate(`/campaigns/${c.id}?setup=1`);
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            savingGuard.current = false;
            setBusy(false);
          }
        }}
      >
        <ErrorNotice message={error || providers.error} />
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
        <section className="stack" aria-label="Source import next step">
          <h2>Next: add your rules & documents</h2>
          <p className="muted">
            Create the campaign first, then choose multiple Markdown, text or PDF files, paste
            rules, or import public Google Docs links. You can add as many sources as you need and
            review extracted text before the GM uses it.
          </p>
        </section>
        <button className="primary" disabled={busy || !name.trim()}>
          {busy ? 'Creating…' : 'Create campaign'}
        </button>
      </form>
    </div>
  );
}
