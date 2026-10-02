import { isConfirmed } from '../../services/options';
import { parseObject } from '../../services/validation';
import { useRef, useState } from 'react';
import type { Campaign, Character, Settings, CharacterTemplate } from '../../services/types';
import { request, requestCollection, json, errorMessage } from '../../services/client';
import { useResource } from '../../hooks/useResource';
import { Field, ErrorNotice, JsonEditor } from '../../components/Controls';
import CharacterSection from './CharacterSection';
import { CHARACTER_SECTIONS } from './sectionOptions';
function Editor({
  campaign,
  character,
  onSaved,
  onTemplateSaved,
}: {
  campaign: Campaign;
  character: Character;
  onSaved: () => Promise<void>;
  onTemplateSaved: () => Promise<void>;
}) {
  const baseRevision = useRef(campaign.revision),
    savingGuard = useRef(false);
  const [feedback, setFeedback] = useState('');
  const [section, setSection] = useState('attributes');
  const [name, setName] = useState(character.name),
    [notes, setNotes] = useState(character.notes),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <article className="panel stack">
      <h3>
        {character.name} <small>{character.type}</small>
      </h3>
      <nav className="tabs sheet-tabs" aria-label={`${character.name} sheet sections`}>
        {CHARACTER_SECTIONS.map(({ key: item, label }) => (
          <button
            key={item}
            className={section === item ? 'selected' : ''}
            aria-current={section === item ? 'page' : undefined}
            onClick={() => setSection(item)}
          >
            {label}
          </button>
        ))}
      </nav>
      {CHARACTER_SECTIONS.map(({ key, label }) => (
        <div key={key} hidden={section !== key}>
          <CharacterSection
            campaign={campaign}
            character={character}
            field={key}
            label={label}
            onSaved={onSaved}
          />
        </div>
      ))}
      {character.notes && (
        <div>
          <h4>Notes</h4>
          <p className="prose">{character.notes}</p>
        </div>
      )}
      <button
        disabled={busy}
        onClick={async () => {
          if (savingGuard.current) return;
          const name = prompt('Template name for this saved character', character.name);
          if (!name?.trim()) return;
          savingGuard.current = true;
          setBusy(true);
          try {
            await request(
              '/character-templates',
              json('POST', {
                name: name.trim(),
                campaignId: campaign.id,
                characterId: character.id,
                revision: campaign.revision,
              })
            );
            await onTemplateSaved();
            setFeedback('Saved character template.');
            setError('');
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            savingGuard.current = false;
            setBusy(false);
          }
        }}
      >
        Save character as template
      </button>
      {feedback && <small role="status">{feedback}</small>}
      <details>
        <summary>Edit character</summary>
        <div className="stack">
          <ErrorNotice message={error} />
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Character notes">
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <button
            disabled={busy || !name.trim()}
            onClick={async () => {
              if (savingGuard.current) return;
              savingGuard.current = true;
              setBusy(true);
              try {
                const saved = await request<Campaign>(
                  `/campaigns/${campaign.id}/characters/${character.id}`,
                  json('PATCH', {
                    revision: baseRevision.current,
                    name,
                    notes,
                  })
                );
                baseRevision.current = saved.revision;
                await onSaved();
                setError('');
                setFeedback('Character saved.');
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                savingGuard.current = false;
                setBusy(false);
              }
            }}
          >
            Save character
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setName(character.name);
              setNotes(character.notes);
              baseRevision.current = campaign.revision;
              setError('');
              setFeedback('Loaded current character; unsaved edits discarded.');
            }}
          >
            Reload current character
          </button>
          <small className="muted">
            Unsaved edits remain here when a game turn finishes. Saving after another change may
            require reloading to resolve a revision conflict.
          </small>
          <button
            className="danger"
            disabled={busy}
            onClick={async () => {
              if (savingGuard.current || !confirm(`Delete character “${character.name}”?`)) return;
              savingGuard.current = true;
              setBusy(true);
              try {
                await request(
                  `/campaigns/${campaign.id}/characters/${character.id}`,
                  json('DELETE', { revision: baseRevision.current })
                );
                await onSaved();
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                savingGuard.current = false;
                setBusy(false);
              }
            }}
          >
            Delete character
          </button>
        </div>
      </details>
    </article>
  );
}
export default function CharacterSheet({
  campaign,
  onSaved,
  options,
  category = 'players',
}: {
  campaign: Campaign;
  onSaved: () => Promise<void>;
  options: Settings | null;
  category?: 'players' | 'npcs';
}) {
  const templates = useResource<CharacterTemplate[]>(
      '/character-templates',
      requestCollection<CharacterTemplate>
    ),
    templateGuard = useRef(false),
    draftGuard = useRef(false),
    draftRevision = useRef<number | null>(null);
  const captureRevision = () => {
    draftRevision.current ??= campaign.revision;
  };
  const [templateId, setTemplateId] = useState(''),
    [templateBusy, setTemplateBusy] = useState(false),
    [templateFeedback, setTemplateFeedback] = useState('');
  const [name, setName] = useState(''),
    [type, setType] = useState(''),
    [sheet, setSheet] = useState('{"attributes":{},"inventory":{},"description":{}}'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [draft, setDraft] = useState('');
  return (
    <section className="stack">
      <h2>{category === 'npcs' ? 'NPCs' : 'Player characters'}</h2>
      <ErrorNotice message={error} />
      <ErrorNotice message={templates.error} />
      {templateFeedback && <small role="status">{templateFeedback}</small>}
      {campaign.characters.map((c) => {
        const player = options?.characterTypeOptions.find((role) => role.id === c.type)?.default;
        return (
          <div key={c.id} hidden={category === 'npcs' ? player !== false : player === false}>
            {player === false ? (
              <details className="npc-entry panel">
                <summary>{c.name}</summary>
                <Editor
                  campaign={campaign}
                  character={c}
                  onSaved={onSaved}
                  onTemplateSaved={templates.reload}
                />
              </details>
            ) : (
              <Editor
                key={c.id}
                campaign={campaign}
                character={c}
                onSaved={onSaved}
                onTemplateSaved={templates.reload}
              />
            )}
          </div>
        );
      })}
      {options &&
        !campaign.characters.some((c) => {
          const player = options.characterTypeOptions.find((role) => role.id === c.type)?.default;
          return category === 'npcs' ? player === false : player === true;
        }) && (
          <p className="muted">
            {category === 'npcs'
              ? 'No NPCs yet. They will appear as you meet them.'
              : 'No player character yet. Add or import one below.'}
          </p>
        )}
      <details className="panel">
        <summary>Reusable character templates</summary>
        <div className="stack">
          <Field label="Character template">
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">Choose a template</option>
              {templates.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <button
            disabled={!templateId || templateBusy}
            onClick={async () => {
              if (templateGuard.current) return;
              templateGuard.current = true;
              setTemplateBusy(true);
              try {
                await request(
                  `/campaigns/${campaign.id}/characters/from-template`,
                  json('POST', { templateId, revision: campaign.revision })
                );
                await onSaved();
                setTemplateFeedback('Character added from template.');
                setError('');
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                templateGuard.current = false;
                setTemplateBusy(false);
              }
            }}
          >
            Add character from template
          </button>
          {templates.data?.map((t) => (
            <article className="source-row" key={t.id}>
              <strong>{t.name}</strong>
              <button
                className="danger"
                aria-label={`Delete character template ${t.name}`}
                disabled={templateBusy}
                onClick={async () => {
                  if (templateGuard.current || !confirm(`Delete character template “${t.name}”?`))
                    return;
                  templateGuard.current = true;
                  setTemplateBusy(true);
                  try {
                    await request(`/character-templates/${t.id}`, json('DELETE', {}));
                    await templates.reload();
                    if (templateId === t.id) setTemplateId('');
                    setTemplateFeedback('Character template deleted.');
                  } catch (e) {
                    setError(errorMessage(e));
                  } finally {
                    templateGuard.current = false;
                    setTemplateBusy(false);
                  }
                }}
              >
                Delete template
              </button>
            </article>
          ))}
          {templates.data?.length === 0 && (
            <p className="muted">Save a character above to reuse it in other campaigns.</p>
          )}
        </div>
      </details>
      <details className="panel">
        <summary>Add a character</summary>
        <div className="stack">
          <Field label="Name">
            <input
              value={name}
              disabled={busy}
              onChange={(e) => {
                captureRevision();
                setName(e.target.value);
              }}
            />
          </Field>
          <Field label="Role">
            <select
              value={type}
              disabled={busy}
              onChange={(e) => {
                captureRevision();
                setType(e.target.value);
              }}
            >
              <option value="">Default role</option>
              {options?.characterTypeOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <JsonEditor
            value={sheet}
            disabled={busy}
            onChange={(value) => {
              captureRevision();
              setSheet(value);
            }}
            label="Advanced: attributes, inventory & description"
          />
          <button
            disabled={busy || !name.trim()}
            onClick={async () => {
              if (draftGuard.current) return;
              draftGuard.current = true;
              setBusy(true);
              try {
                const parsed = parseObject(sheet);
                for (const key of ['attributes', 'inventory', 'description'])
                  if (!parsed[key] || typeof parsed[key] !== 'object' || Array.isArray(parsed[key]))
                    throw new Error(`${key} must be a JSON object.`);
                await request(
                  `/campaigns/${campaign.id}/characters`,
                  json('POST', {
                    revision: draftRevision.current ?? campaign.revision,
                    name,
                    type: type || options?.defaults.characterType,
                    attributes: parsed.attributes,
                    inventory: parsed.inventory,
                    description: parsed.description,
                  })
                );
                await onSaved();
                setName('');
                setSheet('{"attributes":{},"inventory":{},"description":{}}');
                draftRevision.current = null;
                setError('');
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                draftGuard.current = false;
                setBusy(false);
              }
            }}
          >
            Add character
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              draftRevision.current = null;
              setName('');
              setType('');
              setSheet('{"attributes":{},"inventory":{},"description":{}}');
              setError('');
            }}
          >
            Discard character draft
          </button>
          <hr />
          <Field label="Parse a confirmed source">
            <select value={draft} onChange={(e) => setDraft(e.target.value)}>
              <option value="">Choose a reviewed source</option>
              {campaign.sources
                .filter((s) => isConfirmed(s, options))
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </Field>
          <button
            disabled={busy || !draft}
            onClick={async () => {
              if (draftGuard.current) return;
              draftGuard.current = true;
              const revision = campaign.revision;
              setBusy(true);
              try {
                const value = await request<{ draft: Partial<Character> }>(
                  `/campaigns/${campaign.id}/character-drafts`,
                  json('POST', { revision, sourceId: draft })
                );
                draftRevision.current = revision;
                setName(value.draft.name || '');
                setType(value.draft.type || options?.defaults.characterType || '');
                setSheet(
                  JSON.stringify(
                    {
                      attributes: value.draft.attributes || {},
                      inventory: value.draft.inventory || {},
                      description: value.draft.description || {},
                    },
                    null,
                    2
                  )
                );
                setError('');
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                draftGuard.current = false;
                setBusy(false);
              }
            }}
          >
            Generate editable character draft
          </button>
          <p className="muted">
            Parsing uses your selected CLI. Review the draft above and click Add character to save
            it.
          </p>
        </div>
      </details>
    </section>
  );
}
