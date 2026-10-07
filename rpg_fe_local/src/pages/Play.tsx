import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Send,
  Undo2,
  Download,
  BookmarkPlus,
  LoaderCircle,
  Feather,
} from 'lucide-react';
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
import { providerValid as validProvider, isCompleted } from '../services/options';
import CharacterSheet from '../features/characters/CharacterSheet';
import PlayAside from '../features/play/PlayAside';
import CharacterTemplates from '../features/characters/CharacterTemplates';
import CharacterCreator from '../features/characters/CharacterCreator';
import SourceManager from '../features/sources/SourceManager';
import Journal from '../features/journal/Journal';
import GmState from '../features/journal/GmState';
import CampaignContextSettings from '../features/journal/CampaignContextSettings';
import { useTurn } from '../features/play/useTurn';
import { Dictation } from '../features/audio/Dictation';
import { TurnNarrative } from '../features/play/TurnNarrative';
import RuleSystemPicker from '../features/rules/RuleSystemPicker';
import RuleEvidence from '../features/rules/RuleEvidence';
const CHAT_BOTTOM_THRESHOLD_PX = 100;
const CAMPAIGN_TABS = [
  'play',
  'characters',
  'npcs',
  'journal',
  'sources',
  'game master',
  'utility',
];
export default function PlayPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const resource = useResource<CampaignDetail>(`/campaigns/${id}`),
    providers = useResource<Provider[]>('/providers'),
    ruleSystem = useResource<RuleSystemMetadata>(`/campaigns/${id}/rule-system`),
    settings = useResource<Settings>('/settings');
  const location = useLocation();
  const requestedTab = search.get('tab');
  const [tab, setTab] = useState(
      search.get('setup') === '1'
        ? 'sources'
        : requestedTab && CAMPAIGN_TABS.includes(requestedTab)
          ? requestedTab
          : 'play'
    ),
    [draft, setDraft] = useState(''),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false),
    [feedback, setFeedback] = useState(''),
    savingGuard = useRef(false);
  const [showAudit, setShowAudit] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  // In-app links (for example Journal sources) change only the query string; follow them.
  const navigatedTab = search.get('tab');
  const setupMode = search.get('setup') === '1';
  useEffect(() => {
    if (!setupMode && navigatedTab && CAMPAIGN_TABS.includes(navigatedTab)) setTab(navigatedTab);
  }, [location.key, navigatedTab, setupMode]);
  const game = useTurn(resource.data, resource.reload, settings.data),
    campaign = resource.data;
  const transcript = useRef<HTMLElement | null>(null);
  const followChat = useRef(true);
  const openedChat = useRef<string | null>(null);
  const campaignId = campaign?.id;
  const latestTurnId = campaign?.turns.at(-1)?.id;
  const latestMessage = campaign?.turns.at(-1)?.narrative;
  useLayoutEffect(() => {
    if (tab !== 'play' || !campaignId || !settings.data || !transcript.current) return;
    if (openedChat.current !== campaignId) {
      openedChat.current = campaignId;
      followChat.current = true;
    }
    if (followChat.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [campaignId, latestTurnId, latestMessage, settings.data, tab]);
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
  // The e2e mock serves a collection for this resource, so only a metadata object has a name.
  const ruleSystemName = Array.isArray(ruleSystem.data) ? undefined : ruleSystem.data?.systemName;
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
        <Link className="campaign-back" to="/" aria-label="Back to library" title="Back to library">
          <ArrowLeft size={22} aria-hidden="true" />
        </Link>
        <div className="campaign-title">
          {ruleSystemName && <p className="eyebrow">{ruleSystemName}</p>}
          <h1>{campaign.name}</h1>
          {campaign.description && <p className="muted">{campaign.description}</p>}
        </div>
        {provider && model && (
          <p className="gm-chip">
            <span className="gm-chip-dot" aria-hidden="true" />
            Game master: {provider.name} · {model.label}
          </p>
        )}
      </div>
      <ErrorNotice message={error || resource.error || providers.error} />
      {feedback && <p role="status">{feedback}</p>}
      <nav className="tabs" aria-label="Campaign sections">
        {CAMPAIGN_TABS.map((t) => (
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
      <section className="stack utility-page" hidden={tab !== 'utility'}>
        <h2>Utility</h2>
        <div className="utility-campaign-tools">
          <section className="panel stack utility-tool">
            <h3>Campaign backup</h3>
            <p className="muted">
              Download this campaign and its saved history. Restore it through Import campaign in
              the library.
            </p>
            <button
              title="Download a JSON archive with saved campaign data, turns and game records. Original uploaded files are excluded."
              disabled={game.busy || saving}
              onClick={() => void exportCampaign()}
            >
              <Download size={16} />
              Download campaign backup
            </button>
          </section>
          <section className="panel stack utility-tool">
            <h3>Campaign template</h3>
            <p className="muted">Reuse this campaign's setup to start another campaign.</p>
            <button
              title="Save the campaign setup, characters and source text for a new campaign. The new campaign starts with a fresh timeline."
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
              Save campaign template
            </button>
          </section>
        </div>
        {tab === 'utility' && <CharacterTemplates campaign={campaign} onSaved={resource.reload} />}
        <CharacterCreator campaign={campaign} options={settings.data} onSaved={resource.reload} />
      </section>
      <div className="stack" hidden={tab !== 'game master'}>
        <div className="panel provider-panel">
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
        <CampaignContextSettings
          campaign={campaign}
          options={settings.data}
          onSaved={resource.reload}
        />
        <GmState key={campaign.id} campaign={campaign} onSaved={resource.reload} />
      </div>
      <div hidden={tab !== 'play'}>
        {search.get('turn') && (
          <ReferencedTurn campaignId={campaign.id} turnId={search.get('turn')!} />
        )}
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
                      <small>
                        <Feather size={14} aria-hidden="true" />
                        You
                      </small>
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
                      <TurnNarrative
                        turn={t}
                        characters={campaign.characters}
                        terminal={
                          !!settings.data?.turnStatusOptions.find(
                            (option) => option.id === t.status
                          )?.terminal
                        }
                        readable={!!t.narrative && !t.undone && isCompleted(t, settings.data)}
                      />
                    </div>
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
          <aside className="campaign-aside panel" aria-label="Campaign at a glance">
            <PlayAside
              campaign={campaign}
              options={settings.data}
              layout={ruleSystem.data?.sheetLayout}
            />
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
                  <span className="candle" aria-hidden="true" />
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
      </div>
      <div hidden={tab !== 'characters' && tab !== 'npcs'}>
        <CharacterSheet
          campaign={campaign}
          options={settings.data}
          onSaved={resource.reload}
          category={tab === 'npcs' ? 'npcs' : 'players'}
          layout={ruleSystem.data?.sheetLayout}
        />
      </div>
      <div hidden={tab !== 'journal'}>
        <Journal
          campaign={campaign}
          options={settings.data}
          onSaved={resource.reload}
          initialEntryId={search.get('entry')}
          active={tab === 'journal'}
        />
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

/** An older conversation opened from a Journal source link; loaded by id so it need not be in the recent list. */
function ReferencedTurn({ campaignId, turnId }: { campaignId: string; turnId: string }) {
  const turn = useResource<Turn>(`/campaigns/${campaignId}/turns/${turnId}`);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const ready = !!turn.data;
  useEffect(() => {
    if (ready) heading.current?.focus();
  }, [ready, turnId]);
  if (turn.loading) return <p role="status">Opening the referenced conversation…</p>;
  if (turn.error) return <ErrorNotice message={turn.error} />;
  const t = turn.data;
  if (!t || t.undone)
    return <p className="notice">That conversation is no longer part of the story.</p>;
  return (
    <section className="panel referenced-turn" aria-label="Referenced conversation">
      <h2 tabIndex={-1} ref={heading}>
        Referenced conversation
      </h2>
      <time className="muted" dateTime={t.createdAt}>
        {new Date(t.createdAt).toLocaleString()}
      </time>
      <p className="player-action">{t.action}</p>
      {t.narrative && <p className="prose">{t.narrative}</p>}
    </section>
  );
}
