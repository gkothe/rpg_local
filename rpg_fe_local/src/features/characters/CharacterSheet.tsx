import { useRef, useState } from 'react';
import type { Campaign, Character, Settings, SheetLayout } from '../../services/types';
import { request, json, errorMessage } from '../../services/client';
import { Field, ErrorNotice } from '../../components/Controls';
import CharacterSection from './CharacterSection';
import { CHARACTER_SECTIONS } from './sectionOptions';
import AwardedTotal from '../advancement/AwardedTotal';
function Editor({
  campaign,
  character,
  onSaved,
  canDelete,
  layout,
  player,
}: {
  campaign: Campaign;
  character: Character;
  onSaved: () => Promise<void>;
  canDelete: boolean;
  layout?: SheetLayout;
  player?: boolean;
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
    <article className="panel stack character-page">
      <header className="character-header">
        <span className="character-medallion" aria-hidden="true">
          {[...character.name.trim()][0]?.toUpperCase()}
        </span>
        <h3>
          {character.name} <small>{character.type}</small>
        </h3>
      </header>
      <ErrorNotice message={error} />
      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Character notes">
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      {player && <AwardedTotal campaignId={campaign.id} characterId={character.id} />}
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
/** Longest notes preview shown in the NPC table. */
const NPC_NOTES_PREVIEW_CHARS = 90;

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
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const isPlayer = (c: Character) =>
    options?.characterTypeOptions.find((role) => role.id === c.type)?.default;
  const npcs = campaign.characters.filter((c) => isPlayer(c) === false);
  const needle = query.trim().toLowerCase();
  const matches = npcs
    .filter((c) => !needle || `${c.name} ${c.notes}`.toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name));
  const typeLabel = (c: Character) =>
    options?.characterTypeOptions.find((role) => role.id === c.type)?.label ?? c.type;
  const viewing = category === 'npcs' && npcs.some((c) => c.id === openId);
  return (
    <section className="stack">
      <h2>{category === 'npcs' ? 'NPCs' : 'Player characters'}</h2>
      {category === 'npcs' && npcs.length > 0 && !viewing && (
        <div className="npc-list stack">
          <Field label="Search NPCs" hint={`${matches.length} of ${npcs.length} shown`}>
            <input
              type="search"
              value={query}
              placeholder="Name or notes"
              onChange={(e) => setQuery(e.target.value)}
            />
          </Field>
          {matches.length > 0 ? (
            <table className="npc-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Type</th>
                  <th scope="col">Notes</th>
                </tr>
              </thead>
              <tbody>
                {matches.map((c) => (
                  <tr key={c.id} onClick={() => setOpenId(c.id)}>
                    <th scope="row">
                      <button
                        type="button"
                        className="npc-open"
                        onClick={(event) => {
                          event.stopPropagation();
                          setOpenId(c.id);
                        }}
                      >
                        {c.name}
                      </button>
                    </th>
                    <td>{typeLabel(c)}</td>
                    <td className="npc-notes">
                      {c.notes.length > NPC_NOTES_PREVIEW_CHARS
                        ? `${c.notes.slice(0, NPC_NOTES_PREVIEW_CHARS)}…`
                        : c.notes || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">No NPC matches “{query.trim()}”.</p>
          )}
        </div>
      )}
      {viewing && (
        <button type="button" className="npc-back" onClick={() => setOpenId(null)}>
          ← All NPCs
        </button>
      )}
      {campaign.characters.map((c) => {
        const player = isPlayer(c);
        const shown =
          category === 'npcs' ? player === false && viewing && openId === c.id : player !== false;
        return (
          <div key={c.id} hidden={!shown} className={player === false ? 'npc-entry' : undefined}>
            <Editor
              campaign={campaign}
              character={c}
              onSaved={onSaved}
              canDelete={player === false}
              player={player === true}
              layout={layout}
            />
          </div>
        );
      })}
      {options &&
        !campaign.characters.some((c) => {
          const player = isPlayer(c);
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
