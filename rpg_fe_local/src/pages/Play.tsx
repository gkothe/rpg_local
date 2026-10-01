import { useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Send, Undo2, Download, BookmarkPlus } from 'lucide-react';
import { useResource } from '../hooks/useResource';
import type { CampaignDetail, Provider, Settings, Turn } from '../services/types';
import { request, requestCollection, json, errorMessage } from '../services/client';
import { ErrorNotice, Empty } from '../components/Controls';
import ProviderPicker from '../features/providers/ProviderPicker';
import { providerValid as validProvider, isCompleted, isConfirmed } from '../services/options';
import CharacterSheet from '../features/characters/CharacterSheet';
import SourceManager from '../features/sources/SourceManager';
import Journal from '../features/journal/Journal';
import { useTurn } from '../features/play/useTurn';
import { ReadAloud } from '../features/audio/ReadAloud';
import { Dictation } from '../features/audio/Dictation';
export default function PlayPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const resource = useResource<CampaignDetail>(`/campaigns/${id}`),
    providers = useResource<Provider[]>('/providers'),
    settings = useResource<Settings>('/settings');
  const [tab, setTab] = useState(search.get('setup') === '1' ? 'sources' : 'play'),
    [draft, setDraft] = useState(''),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false),
    [feedback, setFeedback] = useState(''),
    savingGuard = useRef(false);
  const [showAudit, setShowAudit] = useState(false);
  const game = useTurn(resource.data, resource.reload, settings.data),
    campaign = resource.data;
  if (!campaign)
    return (
      <div className="page">
        <ErrorNotice message={resource.error} />
        {resource.loading ? (
          <p role="status">Opening campaign…</p>
        ) : (
          <button onClick={() => void resource.reload()}>Retry</button>
        )}
      </div>
    );
  const playable = !!settings.data && validProvider(providers.data || [], campaign.settings);
  async function exportCampaign() {
    if (savingGuard.current) return;
    savingGuard.current = true;
    setSaving(true);
    try {
      const archive = await request(`/campaigns/${id}/export`);
      const blob = new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `local-rpg-${id}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      savingGuard.current = false;
      setSaving(false);
    }
  }
  return (
    <div className="page play-page">
      <div className="page-heading">
        <div>
          <Link className="back" to="/">
            Back to library
          </Link>
          <h1>{campaign.name}</h1>
          <p className="muted">{campaign.description}</p>
        </div>
        <div className="row wrap">
          <button disabled={game.busy || saving} onClick={() => void exportCampaign()}>
            <Download size={16} />
            Export
          </button>
          <button
            disabled={game.busy || saving}
            onClick={async () => {
              if (savingGuard.current) return;
              const name = prompt('Template name', campaign.name);
              if (!name) return;
              savingGuard.current = true;
              setSaving(true);
              try {
                await request(
                  '/templates',
                  json('POST', { name, campaignId: id, revision: campaign.revision })
                );
                setError('');
                setFeedback('Campaign template saved.');
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                savingGuard.current = false;
                setSaving(false);
              }
            }}
          >
            <BookmarkPlus size={16} />
            Save template
          </button>
        </div>
      </div>
      <ErrorNotice message={error || resource.error || providers.error} />
      {feedback && <p role="status">{feedback}</p>}
      <div className="panel provider-panel">
        <ProviderPicker
          providers={providers.data || []}
          value={campaign.settings}
          disabled={game.busy || saving}
          onRefresh={() => providers.reload('/providers?refresh=true')}
          onChange={async (value) => {
            if (savingGuard.current) return;
            savingGuard.current = true;
            setSaving(true);
            setFeedback('');
            try {
              await request(
                `/campaigns/${id}`,
                json('PATCH', { revision: campaign.revision, settings: value })
              );
              await resource.reload();
              setError('');
              setFeedback('Game master settings saved.');
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              savingGuard.current = false;
              setSaving(false);
            }
          }}
        />
      </div>
      <nav className="tabs" aria-label="Campaign sections">
        {['play', 'characters', 'journal', 'sources'].map((t) => (
          <button
            aria-current={tab === t ? 'page' : undefined}
            className={tab === t ? 'selected' : ''}
            key={t}
            onClick={() => setTab(t)}
          >
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>
      <div hidden={tab !== 'play'}>
        <label className="check">
          <input
            type="checkbox"
            checked={showAudit}
            onChange={(e) => setShowAudit(e.target.checked)}
          />
          Show turn audit (including undone and failed attempts)
        </label>
        <button
          disabled={saving}
          onClick={async () => {
            if (savingGuard.current) return;
            savingGuard.current = true;
            setSaving(true);
            try {
              const turns = await requestCollection<Turn>(`/campaigns/${id}/turns`);
              resource.setData((current) =>
                current && current.id === id ? { ...current, turns } : current
              );
              setError('');
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              savingGuard.current = false;
              setSaving(false);
            }
          }}
        >
          Load full saved transcript
        </button>
        <div className="play-layout">
          <section className="transcript" aria-label="Campaign transcript">
            {campaign.turns.filter((t) => isCompleted(t, settings.data) && !t.undone).length ===
              0 && (
              <Empty title="Begin the first scene">
                Add your characters and confirm source material, then tell the GM what you do.
              </Empty>
            )}
            {campaign.turns
              .filter((t) => showAudit || (isCompleted(t, settings.data) && !t.undone))
              .map((t, index) => (
                <article className="turn" key={t.id}>
                  <div className="folio">{String(index + 1).padStart(2, '0')}</div>
                  <div className="turn-content">
                    {showAudit && (
                      <p className="muted">
                        {t.undone
                          ? 'Undone'
                          : settings.data?.turnStatusOptions.find((o) => o.id === t.status)
                              ?.label || t.status}{' '}
                        · {new Date(t.createdAt).toLocaleString()}
                      </p>
                    )}
                    <div className="player-action">
                      <small>You</small>
                      <p>{t.action}</p>
                    </div>
                    <div className="gm-message">
                      <small>Game master</small>
                      <div className="prose">{t.narrative}</div>
                      {t.narrative && !t.undone && isCompleted(t, settings.data) && (
                        <ReadAloud text={t.narrative} />
                      )}
                    </div>
                    {t.error && showAudit && <ErrorNotice message={t.error} />}
                    {showAudit &&
                      settings.data?.turnStatusOptions.find((o) => o.id === t.status)?.terminal &&
                      !isCompleted(t, settings.data) && (
                        <button
                          disabled={game.busy}
                          onClick={() => {
                            if (
                              draft.trim() &&
                              draft !== t.action &&
                              !confirm('Replace the unsent composer draft with this action?')
                            )
                              return;
                            setDraft(t.action);
                          }}
                        >
                          Restore action to composer
                        </button>
                      )}
                    {t.changes.length > 0 && (
                      <details className="changes">
                        <summary>
                          {t.changes.length} state change{t.changes.length === 1 ? '' : 's'}
                        </summary>
                        <ul>
                          {t.changes.map((change, i) => (
                            <li key={i}>{change}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                </article>
              ))}
          </section>
          <aside className="campaign-aside panel">
            <h2>At a glance</h2>
            <h3>Characters</h3>
            {campaign.characters.length ? (
              campaign.characters.map((c) => (
                <button key={c.id} className="character-link" onClick={() => setTab('characters')}>
                  <strong>{c.name}</strong>
                  <small>{c.type}</small>
                </button>
              ))
            ) : (
              <p className="muted">No characters yet.</p>
            )}
            <h3>Campaign memory</h3>
            <p>
              {campaign.memory?.valid
                ? campaign.memory.text
                : 'Memory will build as the campaign grows.'}
            </p>
            <button className="quiet" onClick={() => setTab('journal')}>
              Inspect context
            </button>
            <h3>Rules</h3>
            <p>
              {campaign.sources.filter((s) => isConfirmed(s, settings.data)).length} confirmed
              source(s)
            </p>
          </aside>
        </div>
        <section className="composer panel">
          <ErrorNotice message={game.error} />
          {game.uncertainAction !== null && (
            <div className="notice">
              <p>
                The last submission may have reached the server. Retry checks the same saved
                request; it does not create a second turn.
              </p>
              <button
                disabled={game.busy}
                onClick={async () => {
                  const action = game.uncertainAction;
                  if (await game.retryOriginal())
                    setDraft((current) => (current === action ? '' : current));
                }}
              >
                Retry original action
              </button>
            </div>
          )}
          {game.busy && (
            <div className="row">
              <p role="status">
                {game.submitting ? 'Submitting action…' : 'GM is preparing your turn…'}
              </p>
              {!game.submitting && <button onClick={() => void game.cancel()}>Cancel turn</button>}
            </div>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const sent = draft;
              if (await game.send(sent, campaign.settings))
                setDraft((current) => (current === sent ? '' : current));
            }}
          >
            <label className="field">
              <span>Your action</span>
              <textarea
                rows={4}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="What do you do?"
                maxLength={20000}
              />
            </label>
            <div className="composer-actions">
              <div className="row wrap">
                <Dictation
                  maxSeconds={settings.data?.audio.maxSeconds || 0}
                  language={settings.data?.defaults.transcriptionLanguage || ''}
                  disabled={game.busy || !settings.data?.audio.available}
                  onTranscript={(text) =>
                    setDraft((current) => (current ? `${current}\n${text}` : text))
                  }
                />
                <button
                  type="button"
                  disabled={
                    game.busy ||
                    !campaign.turns.some((t) => isCompleted(t, settings.data) && !t.undone)
                  }
                  onClick={() => {
                    if (
                      confirm('Undo the latest completed turn and restore its game-state changes?')
                    )
                      void game.undo();
                  }}
                >
                  <Undo2 size={16} />
                  Undo last turn
                </button>
              </div>
              <button
                className="primary"
                disabled={game.busy || saving || !draft.trim() || !playable}
              >
                <Send size={16} />
                Send action
              </button>
            </div>
            {!playable && <p className="muted">Select an available CLI and model above to play.</p>}
            {settings.data && !settings.data.audio.available && (
              <small className="muted">
                Dictation unavailable:{' '}
                {settings.data.audio.reason || 'Local transcription is not configured.'} Typing is
                always available.
              </small>
            )}
          </form>
        </section>
      </div>
      <div hidden={tab !== 'characters'}>
        <CharacterSheet campaign={campaign} options={settings.data} onSaved={resource.reload} />
      </div>
      <div hidden={tab !== 'journal'}>
        <Journal campaign={campaign} options={settings.data} onSaved={resource.reload} />
      </div>
      <div hidden={tab !== 'sources'}>
        {search.get('setup') === '1' && (
          <p className="notice">
            Campaign created. Add and confirm your sources here, then open Characters to prepare
            your sheet or Play when you are ready.
          </p>
        )}
        <SourceManager
          key={campaign.id}
          campaign={campaign}
          options={settings.data}
          onSaved={resource.reload}
        />
      </div>
    </div>
  );
}
