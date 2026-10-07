import { useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, ArrowRight, Upload, Trash2, Feather } from 'lucide-react';
import { useResource } from '../hooks/useResource';
import { request, requestCollection, json, errorMessage } from '../services/client';
import type { Campaign, RuleContext, Template } from '../services/types';
import { Empty, ErrorNotice } from '../components/Controls';
import { hueFromId } from '../components/hue';
import { dieShape } from '../features/play/dieShapes';
const sigil = dieShape(20);
export default function LibraryPage() {
  const campaigns = useResource<Campaign[]>('/campaigns', requestCollection<Campaign>),
    templates = useResource<Template[]>('/templates', requestCollection<Template>),
    ruleSystems = useResource<RuleContext[]>('/rule-systems', requestCollection<RuleContext>),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    savingGuard = useRef(false);
  const navigate = useNavigate();
  // Cover decoration only: a missing or failed rule-system list simply omits the name line.
  const systemNames = new Map((ruleSystems.data ?? []).map((s) => [s.systemId, s.systemName]));
  const systemName = (c: Campaign) =>
    systemNames.get(c.ruleSystemId ?? '') ?? c.ruleReference?.systemName;
  async function importFile(file: File) {
    if (savingGuard.current) return;
    savingGuard.current = true;
    setBusy(true);
    setError('');
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('Archive exceeds 20 MB.');
      const archive = JSON.parse(await file.text());
      const campaign = await request<Campaign>('/campaigns/import', json('POST', { archive }));
      navigate(`/campaigns/${campaign.id}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      savingGuard.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="page library">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Your saved games</p>
          <h1>Campaign library</h1>
          <p className="muted">Choose where to continue, or begin a new campaign.</p>
        </div>
        <Link className="button primary" to="/new">
          <Plus size={18} />
          New campaign
        </Link>
      </div>
      <ErrorNotice message={error || campaigns.error || templates.error} />
      {campaigns.loading ? (
        <p role="status">Loading campaigns…</p>
      ) : campaigns.data?.length ? (
        <div className="campaign-grid shelf">
          {campaigns.data.map((c) => (
            <article
              className="campaign-card"
              key={c.id}
              style={{ '--cover-hue': hueFromId(c.id) } as CSSProperties}
            >
              <div className="book-cover">
                {systemName(c) && <p className="book-system">{systemName(c)}</p>}
                <svg
                  className="book-sigil"
                  viewBox="0 0 48 48"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path className="die-outline" d={sigil.outline} />
                  {sigil.inner && <path className="die-inner" d={sigil.inner} />}
                </svg>
                <h2>{c.name}</h2>
                {c.description && <p className="book-blurb">{c.description}</p>}
              </div>
              <p className="muted book-updated">
                Updated {new Date(c.updatedAt).toLocaleDateString()}
              </p>
              <footer>
                <Link to={`/campaigns/${c.id}`}>
                  Continue <ArrowRight size={17} />
                </Link>
                <button
                  aria-label={`Delete ${c.name}`}
                  className="quiet danger"
                  disabled={busy}
                  onClick={async () => {
                    if (savingGuard.current) return;
                    if (
                      !confirm(
                        `Delete “${c.name}” and its saved campaign? Export a backup first if needed.`
                      )
                    )
                      return;
                    savingGuard.current = true;
                    setBusy(true);
                    try {
                      await request(`/campaigns/${c.id}`, json('DELETE', { revision: c.revision }));
                      await campaigns.reload();
                    } catch (e) {
                      setError(errorMessage(e));
                    } finally {
                      savingGuard.current = false;
                      setBusy(false);
                    }
                  }}
                >
                  <Trash2 size={17} />
                </button>
              </footer>
            </article>
          ))}
          <Link className="campaign-card campaign-unwritten" to="/new">
            <Feather size={34} aria-hidden="true" />
            <strong>An unwritten book</strong>
            <span>Start a new campaign</span>
          </Link>
        </div>
      ) : (
        <Empty title="Your next story starts here">
          Create a campaign with your own rules and characters. Your saved games will appear here.
        </Empty>
      )}
      <section className="panel library-tools">
        <h2>Portable saves</h2>
        <p className="muted">Import a Local RPG campaign archive to create a separate copy.</p>
        <label className="button">
          <Upload size={16} />
          Import campaign
          <input
            className="visually-hidden"
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importFile(file);
              e.target.value = '';
            }}
          />
        </label>
      </section>
      {!!templates.data?.length && (
        <section>
          <h2>Templates</h2>
          <div className="campaign-grid">
            {templates.data.map((t) => (
              <article className="panel" key={t.id}>
                <h3>{t.name}</h3>
                <button
                  disabled={busy}
                  onClick={async () => {
                    if (savingGuard.current) return;
                    savingGuard.current = true;
                    setBusy(true);
                    try {
                      const c = await request<Campaign>(
                        `/templates/${t.id}/campaigns`,
                        json('POST', {})
                      );
                      navigate(`/campaigns/${c.id}`);
                    } catch (e) {
                      setError(errorMessage(e));
                    } finally {
                      savingGuard.current = false;
                      setBusy(false);
                    }
                  }}
                >
                  Use template
                </button>
                <button
                  className="quiet danger"
                  disabled={busy}
                  onClick={async () => {
                    if (savingGuard.current) return;
                    if (!confirm(`Delete template “${t.name}”? Existing campaigns will remain.`))
                      return;
                    savingGuard.current = true;
                    setBusy(true);
                    try {
                      await request(`/templates/${t.id}`, json('DELETE', {}));
                      await templates.reload();
                    } catch (e) {
                      setError(errorMessage(e));
                    } finally {
                      savingGuard.current = false;
                      setBusy(false);
                    }
                  }}
                >
                  Delete template
                </button>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
