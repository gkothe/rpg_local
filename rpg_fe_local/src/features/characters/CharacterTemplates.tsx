import { useRef, useState } from 'react';
import type { Campaign, CharacterTemplate } from '../../services/types';
import { request, requestCollection, json, errorMessage } from '../../services/client';
import { useResource } from '../../hooks/useResource';
import { Field, ErrorNotice } from '../../components/Controls';

export default function CharacterTemplates({
  campaign,
  onSaved,
}: {
  campaign: Campaign;
  onSaved: () => Promise<void>;
}) {
  const templates = useResource<CharacterTemplate[]>(
    '/character-templates',
    requestCollection<CharacterTemplate>
  );
  const templateGuard = useRef(false);
  const [templateId, setTemplateId] = useState('');
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateFeedback, setTemplateFeedback] = useState('');
  const [error, setError] = useState('');
  return (
    <div className="stack">
      <ErrorNotice message={error || templates.error} />
      {templateFeedback && <small role="status">{templateFeedback}</small>}
      <details className="panel">
        <summary>Reusable character templates</summary>
        <div className="stack">
          <p className="muted">
            Copy a saved character into this campaign. Save templates from individual characters in
            Characters or NPCs.
          </p>
          <Field
            label="Character template"
            tooltip="Choose a saved character to copy its name, role, attributes, inventory and description. Private notes are excluded."
          >
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
            title="Add an independent copy of the selected character to this campaign."
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
                title="Remove this saved template. Characters already created from it are kept."
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
            <p className="muted">
              Save a character as a template in Characters or NPCs to reuse it in other campaigns.
            </p>
          )}
        </div>
      </details>
    </div>
  );
}
