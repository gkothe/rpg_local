import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Send, Undo2, Download, BookmarkPlus, LoaderCircle } from 'lucide-react';
import { useResource } from '../hooks/useResource';
import type {
  CampaignDetail,
  Provider,
  Settings,
  Turn,
  RuleSystemMetadata,
} from '../services/types';
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
import { DiceRolls } from '../features/play/DiceRolls';
import RuleSystemPicker from '../features/rules/RuleSystemPicker';
import RuleEvidence from '../features/rules/RuleEvidence';
const CHAT_BOTTOM_THRESHOLD_PX = 100;
export default function PlayPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const resource = useResource<CampaignDetail>(`/campaigns/${id}`),
    providers = useResource<Provider[]>('/providers'),
    ruleSystem = useResource<RuleSystemMetadata>(`/campaigns/${id}/rule-system`),
    settings = useResource<Settings>('/settings');
  const [tab, setTab] = useState(search.get('setup') === '1' ? 'sources' : 'play'),
    [draft, setDraft] = useState(''),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false),
    [feedback, setFeedback] = useState(''),
    savingGuard = useRef(false);
  const [showAudit, setShowAudit] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const game = useTurn(resource.data, resource.reload, settings.data),
    campaign = resource.data;
  const transcript = useRef<HTMLElement | null>(null);
  const followChat = useRef(true);
  const latestMessage = campaign?.turns.at(-1)?.narrative;
  useEffect(() => {
    if (tab === 'play' && transcript.current && followChat.current)
      transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [latestMessage, tab]);
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
  const provider = providers.data?.find((provider) => provider.id === campaign.settings.provider);
  const model = provider?.models.find((model) => model.id === campaign.settings.model);
  const bookSelected = !!campaign.ruleSystemId;
  const rulesBlocked = campaign.ruleResolution
    ? 'Resolve the saved rule-library reference before playing.'
    : bookSelected && (!provider?.rules?.supported || !model?.rules?.supported)
      ? (model?.rules?.reason ??
        provider?.rules?.reason ??
        'Book gameplay is unavailable for the selected CLI/model.')
      : '';
  const playable =
    !!settings.data && !rulesBlocked && validProvider(providers.data || [], campaign.settings);
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
      <nav className="tabs" aria-label="Campaign sections">
        {['play', 'characters', 'npcs', 'journal', 'sources', 'game master'].map((t) => (
          <button
            aria-current={tab === t ? 'page' : undefined}
            className={tab === t ? 'selected' : ''}
            key={t}
            onClick={() => setTab(t)}
          >
            {t === 'npcs' ? 'NPCs' : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>
      <div className="panel provider-panel" hidden={tab !== 'game master'}>
        <RuleSystemPicker
          campaignId={campaign.id}
          value={campaign.ruleSystemId ?? null}
          unresolved={campaign.ruleResolution?.reference}
          disabled={game.busy || saving}
          onChange={async (systemId) => {
            if (savingGuard.current) return;
            savingGuard.current = true;
            setSaving(true);
            try {
              await request(
                `/campaigns/${id}/rule-system${campaign.ruleResolution ? '/resolution' : ''}`,
                json(campaign.ruleResolution ? 'POST' : 'PATCH', {
                  revision: campaign.revision,
                  systemId,
                  requestId: crypto.randomUUID(),
                })
              );
              await resource.reload();
              await ruleSystem.reload();
              setError('');
              setFeedback(
                'Rule selection saved. The next new action uses the latest published rules.'
              );
            } catch (error) {
              setError(errorMessage(error));
            } finally {
              savingGuard.current = false;
              setSaving(false);
            }
          }}
        />
        <h2>Game master</h2>
        <p className="muted">
          Change CLI, model or effort between turns. Your campaign, characters and saved context
          stay with the game; the next turn uses your new selection.
        </p>
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
      <div hidden={tab !== 'play'}>
        <div className="transcript-options">
          <label className="check">
            <input
              type="checkbox"
              checked={showAudit}
              onChange={(e) => setShowAudit(e.target.checked)}
            />
            Show turn audit (including undone and failed attempts)
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={showDebug}
              onChange={(e) => setShowDebug(e.target.checked)}
            />
            Show debug info
          </label>
        </div>
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
          <section
            className="transcript"
            aria-label="Campaign transcript"
            ref={transcript}
            onScroll={(event) => {
              const element = event.currentTarget;
              followChat.current =
                element.scrollHeight - element.scrollTop - element.clientHeight <
                CHAT_BOTTOM_THRESHOLD_PX;
            }}
          >
            {campaign.turns.filter((t) => isCompleted(t, settings.data) && !t.undone).length ===
              0 && (
              <Empty title="Begin the first scene">
                Add your characters and confirm source material, then tell the GM what you do.
              </Empty>
            )}
            {campaign.turns
              .filter(
                (t) =>
                  showAudit ||
                  (!t.undone &&
                    (isCompleted(t, settings.data) ||
                      t.diceRetry ||
                      t.editingPending ||
                      ((t.rolls?.length ?? 0) > 0 &&
                        settings.data?.turnStatusOptions.find((option) => option.id === t.status)
                          ?.terminal)))
              )
              .map((t) => (
                <article className="turn" key={t.id}>
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
                      <time className="message-time" dateTime={t.createdAt}>
                        {new Date(t.createdAt).toLocaleString()}
                      </time>
                      <p>{t.action}</p>
                    </div>
                    <div className="gm-message">
                      <small>Game master</small>
                      <time className="message-time" dateTime={t.completedAt || t.createdAt}>
                        {new Date(t.completedAt || t.createdAt).toLocaleString()}
                      </time>
                      <div className="prose">{t.narrative}</div>
                      {t.narrative && !t.undone && isCompleted(t, settings.data) && (
                        <ReadAloud text={t.narrative} />
                      )}
                    </div>
                    {showDebug && (
                      <DiceRolls
                        turn={t}
                        characters={campaign.characters}
                        terminal={
                          !!settings.data?.turnStatusOptions.find(
                            (option) => option.id === t.status
                          )?.terminal
                        }
                      />
                    )}
                    {showDebug && (
                      <RuleEvidence
                        turn={t}
                        current={ruleSystem.data ?? undefined}
                        terminal={
                          !!settings.data?.turnStatusOptions.find(
                            (option) => option.id === t.status
                          )?.terminal
                        }
                      />
                    )}
                    {t.error && <ErrorNotice message={t.error} />}
                    {t.traceWarning && <p className="notice">{t.traceWarning}</p>}
                    {t.editingPending && (
                      <div className="notice">
                        <p>
                          The GM turn is saved. Finish narrative editing before continuing. Resuming
                          does not repeat gameplay or dice.
                        </p>
                        {t.editingResume?.available ? (
                          <button
                            disabled={game.busy || game.uncertainEditingResume}
                            onClick={() => void game.resumeEditing(t)}
                          >
                            Resume narrative editing
                          </button>
                        ) : (
                          <p className="muted">{t.editingResume?.reason}</p>
                        )}
                        <button disabled={game.busy} onClick={() => void game.cancel(t)}>
                          Cancel pending turn
                        </button>
                      </div>
                    )}
                    {showDebug && !!t.operationExplanations?.length && (
                      <details className="changes">
                        <summary>Reasons for state changes</summary>
                        <ul>
                          {t.operationExplanations.map((explanation) => (
                            <li key={explanation.operationIndex}>{explanation.reason}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {t.diceRetry && (
                      <div className="dice-retry">
                        {t.diceRetry.available ? (
                          <>
                            <p className="muted">
                              Retry continues the original action and keeps its saved dice. The
                              composer draft stays unchanged.
                            </p>
                            <button
                              disabled={
                                game.busy ||
                                saving ||
                                !playable ||
                                game.uncertainAction !== null ||
                                game.uncertainDiceRetry
                              }
                              onClick={() => void game.retryDice(t)}
                            >
                              Retry with saved dice
                            </button>
                          </>
                        ) : (
                          <p className="muted">{t.diceRetry.reason}</p>
                        )}
                      </div>
                    )}
                    {showAudit &&
                      !t.editingPending &&
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
                          Use as a new action (new dice)
                        </button>
                      )}
                    {showDebug && t.changes.length > 0 && (
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
                <button
                  key={c.id}
                  className="character-link"
                  onClick={() =>
                    setTab(
                      settings.data?.characterTypeOptions.find((role) => role.id === c.type)
                        ?.default === false
                        ? 'npcs'
                        : 'characters'
                    )
                  }
                >
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
          {game.uncertainEditingResume && (
            <div className="notice">
              <p>
                The editing request may have reached the server. Check the same request before
                continuing.
              </p>
              <button disabled={game.busy} onClick={() => void game.resumeEditing()}>
                Check original editing request
              </button>
            </div>
          )}
          {game.uncertainDiceRetry && (
            <div className="notice">
              <p>
                The dice retry may have reached the server. Check the same request before starting
                another action.
              </p>
              <button disabled={game.busy} onClick={() => void game.retryDice()}>
                Check original dice retry
              </button>
            </div>
          )}
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
              {game.busy && (
                <div className="composer-progress row wrap">
                  <p role="status">
                    <LoaderCircle className="loading-spinner" aria-hidden="true" />{' '}
                    {game.submitting
                      ? 'Submitting action…'
                      : game.turn?.editingPending
                        ? 'Editing GM narrative…'
                        : 'GM is preparing your turn…'}
                  </p>
                  {!game.submitting && (
                    <button type="button" onClick={() => void game.cancel()}>
                      Cancel turn
                    </button>
                  )}
                </div>
              )}
              <button
                className="primary"
                disabled={game.busy || game.editingBlocked || saving || !draft.trim() || !playable}
              >
                {game.busy ? (
                  <LoaderCircle size={16} className="loading-spinner" aria-hidden="true" />
                ) : (
                  <Send size={16} />
                )}
                {game.busy ? 'GM is responding…' : 'Send action'}
              </button>
            </div>
            {!playable && (
              <p className="muted">
                {rulesBlocked || 'Select an available CLI and model above to play.'}
              </p>
            )}
            {settings.data && !settings.data.audio.available && (
              <small className="muted">
                Dictation unavailable:{' '}
                {settings.data.audio.reason || 'Local transcription is not configured.'} Run
                setup-voice.cmd on the game computer, then restart the game.
              </small>
            )}
          </form>
        </section>
      </div>
      <div hidden={tab !== 'characters' && tab !== 'npcs'}>
        <CharacterSheet
          campaign={campaign}
          options={settings.data}
          onSaved={resource.reload}
          category={tab === 'npcs' ? 'npcs' : 'players'}
        />
      </div>
      <div hidden={tab !== 'journal'}>
        <Journal campaign={campaign} options={settings.data} onSaved={resource.reload} />
      </div>
      <div hidden={tab !== 'sources'}>
        {search.get('setup') === '1' && (
          <p className="notice">
            Campaign created. Imported documents are ready to use. Open Characters to prepare your
            sheet or Play when you are ready. Reviewing source text is optional.
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
