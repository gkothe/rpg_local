import { useRef, useState } from 'react';
import type { Campaign, Character } from '../../services/types';
import { request, json, errorMessage } from '../../services/client';
import { parseObject } from '../../services/validation';
import { ErrorNotice, Field } from '../../components/Controls';
import CharacterData from './CharacterData';
import { CHARACTER_SECTIONS } from './sectionOptions';

export default function CharacterSection({
  campaign,
  character,
  field,
  label,
  onSaved,
}: {
  campaign: Campaign;
  character: Character;
  field: (typeof CHARACTER_SECTIONS)[number]['key'];
  label: string;
  onSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const revision = useRef(campaign.revision);
  const guard = useRef(false);
  const loadCurrent = () => {
    setDraft(JSON.stringify(character[field], null, 2));
    revision.current = campaign.revision;
    setError('');
    setFeedback('');
  };
  return (
    <section className="stack character-section" aria-label={`${character.name} ${label}`}>
      <div className="section-heading">
        <h4>{label}</h4>
        <button
          disabled={busy}
          onClick={() => {
            if (!editing && draft === null) loadCurrent();
            setEditing(!editing);
          }}
        >
          {editing ? 'View' : 'Edit JSON'}
        </button>
      </div>
      <ErrorNotice message={error} />
      {feedback && <small role="status">{feedback}</small>}
      {editing ? (
        <>
          <Field label={`${label} JSON`}>
            <textarea
              className="code"
              rows={12}
              spellCheck={false}
              disabled={busy}
              value={draft || ''}
              onChange={(e) => setDraft(e.target.value)}
            />
          </Field>
          <div className="section-actions">
            <button
              disabled={busy}
              onClick={async () => {
                if (guard.current) return;
                guard.current = true;
                setBusy(true);
                try {
                  const value = parseObject(draft || '');
                  const saved = await request<Campaign>(
                    `/campaigns/${campaign.id}/characters/${character.id}`,
                    json('PATCH', { revision: revision.current, [field]: value })
                  );
                  revision.current = saved.revision;
                  await onSaved();
                  setDraft(null);
                  setEditing(false);
                  setError('');
                  setFeedback(`${label} saved.`);
                } catch (e) {
                  setError(errorMessage(e));
                } finally {
                  guard.current = false;
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Saving…' : `Save ${label}`}
            </button>
            <button disabled={busy} onClick={loadCurrent}>
              Reload current section
            </button>
          </div>
          <small className="muted">
            View keeps your unfinished edits. Reload current section discards them.
          </small>
        </>
      ) : (
        <CharacterData value={character[field]} />
      )}
    </section>
  );
}
