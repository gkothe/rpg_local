import { useRef, useState } from 'react';
import { isConfirmed } from '../../services/options';
import { parseObject } from '../../services/validation';
import type { Campaign, Character, Settings } from '../../services/types';
import { request, json, errorMessage } from '../../services/client';
import { Field, ErrorNotice, JsonEditor } from '../../components/Controls';

export default function CharacterCreator({
  campaign,
  onSaved,
  options,
}: {
  campaign: Campaign;
  onSaved: () => Promise<void>;
  options: Settings | null;
}) {
  const draftGuard = useRef(false),
    draftRevision = useRef<number | null>(null);
  const captureRevision = () => {
    draftRevision.current ??= campaign.revision;
  };
  const [name, setName] = useState(''),
    [type, setType] = useState(''),
    [sheet, setSheet] = useState('{"attributes":{},"inventory":{},"description":{}}'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [draft, setDraft] = useState('');
  return (
    <div className="stack">
      <ErrorNotice message={error} />
      <details className="panel">
        <summary>Add a character</summary>
        <div className="stack">
          <p className="muted">
            Create a player character or NPC manually, or draft one from a confirmed campaign
            source.
          </p>
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
          <Field
            label="Role"
            tooltip="Choose whether this character is controlled by the player or belongs to the NPC roster."
          >
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
            title="Save the name, role and sheet below as a new character in this campaign."
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
            title="Clear the unsaved character form. Existing characters are kept."
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
            title="Use the selected AI CLI to draft a character from this source. Review the result before adding it."
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
    </div>
  );
}
