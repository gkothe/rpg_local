import { useRef, useState } from 'react';
import { isConfirmed } from '../../services/options';
import type { Campaign, Settings } from '../../services/types';
import { Field, ErrorNotice } from '../../components/Controls';
import { request, json, errorMessage } from '../../services/client';

export default function CampaignContextSettings({
  campaign,
  options,
  onSaved,
}: {
  campaign: Campaign;
  options: Settings | null;
  onSaved: () => Promise<void>;
}) {
  const savingGuard = useRef(false);
  const [campaignName, setCampaignName] = useState(campaign.name);
  const [description, setDescription] = useState(campaign.description);
  const [instructions, setInstructions] = useState(campaign.instructions);
  const [pinnedSources, setPinnedSources] = useState(campaign.pinnedSourceIds);
  const [budgets, setBudgets] = useState(campaign.budgets);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const baseRevision = useRef(campaign.revision);
  async function save(path: string, body: unknown) {
    if (savingGuard.current) return;
    savingGuard.current = true;
    try {
      const saved = await request<Campaign>(path, json('PATCH', body));
      baseRevision.current = saved.revision;
      await onSaved();
      setError('');
      setFeedback('Context settings saved.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      savingGuard.current = false;
    }
  }
  return (
    <section className="stack">
      <ErrorNotice message={error} />
      {feedback && <small role="status">{feedback}</small>}
      <div className="panel stack">
        <h3>Campaign context</h3>
        <Field label="Campaign name">
          <input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} />
        </Field>
        <Field
          label="Description"
          tooltip="A short summary for you, shown in the campaign library and header. It is not sent to the GM. Use imported sources for campaign background and GM instructions for how the game should run."
        >
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field
          label="GM instructions"
          tooltip="Instructions for how the GM should run this campaign, such as narration style, pacing and player boundaries. Sent as instructions on every turn."
        >
          <textarea
            rows={4}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </Field>
        <h3>Sources and memory</h3>
        <fieldset>
          <legend>Pinned source material</legend>
          {campaign.sources
            .filter((s) => isConfirmed(s, options))
            .map((s) => (
              <label className="check" key={s.id}>
                <input
                  type="checkbox"
                  checked={pinnedSources.includes(s.id)}
                  onChange={(e) =>
                    setPinnedSources((current) =>
                      e.target.checked ? [...current, s.id] : current.filter((id) => id !== s.id)
                    )
                  }
                />
                {s.name}
              </label>
            ))}
          <small>Selected source documents are included in full every turn.</small>
        </fieldset>
        {(['compaction'] as const).map((key) => (
          <Field label="Compaction batch target (UTF-8 bytes)" key={key}>
            <input
              type="number"
              min={256}
              max={options?.defaults.budgets[key]}
              value={budgets[key]}
              onChange={(e) => setBudgets({ ...budgets, [key]: Number(e.target.value) })}
            />
          </Field>
        ))}
        <button
          onClick={() =>
            void save(`/campaigns/${campaign.id}`, {
              revision: baseRevision.current,
              name: campaignName,
              description,
              instructions,
              pinnedSourceIds: pinnedSources,
              budgets,
            })
          }
        >
          Save context settings
        </button>
      </div>
    </section>
  );
}
