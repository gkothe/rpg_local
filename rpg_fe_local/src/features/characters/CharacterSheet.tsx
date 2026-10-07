import { useRef, useState } from 'react';
import type { Campaign, Character, Settings, SheetLayout } from '../../services/types';
import { request, json, errorMessage } from '../../services/client';
import { Field, ErrorNotice } from '../../components/Controls';
import CharacterSection from './CharacterSection';
import { CHARACTER_SECTIONS } from './sectionOptions';
function Editor({
  campaign,
  character,
  onSaved,
  canDelete,
  layout,
}: {
  campaign: Campaign;
  character: Character;
  onSaved: () => Promise<void>;
  canDelete: boolean;
  layout?: SheetLayout;
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
      <ErrorNotice message={error} />
      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Character notes">
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
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
            layout={layout}
            onSaved={onSaved}
          />
        </div>
      ))}
      {feedback && <small role="status">{feedback}</small>}
      <div className="row wrap character-actions">
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
        {canDelete && (
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
        )}
        <button
          className="primary character-save"
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
      </div>
    </article>
  );
}
export default function CharacterSheet({
  campaign,
  onSaved,
  options,
  category = 'players',
  layout,
}: {
  campaign: Campaign;
  onSaved: () => Promise<void>;
  options: Settings | null;
  category?: 'players' | 'npcs';
  layout?: SheetLayout;
}) {
  return (
    <section className="stack">
      <h2>{category === 'npcs' ? 'NPCs' : 'Player characters'}</h2>
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
                  canDelete
                  layout={layout}
                />
              </details>
            ) : (
              <Editor
                key={c.id}
                campaign={campaign}
                character={c}
                onSaved={onSaved}
                canDelete={false}
                layout={layout}
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
              : 'No player character yet. Add or import one in Utility.'}
          </p>
        )}
    </section>
  );
}
