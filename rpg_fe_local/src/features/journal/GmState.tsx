import { useRef, useState } from 'react';
import type { Campaign } from '../../services/types';
import { ErrorNotice, JsonEditor } from '../../components/Controls';
import { parseObject } from '../../services/validation';
import { request, json, errorMessage } from '../../services/client';

export default function GmState({
  campaign,
  onSaved,
}: {
  campaign: Campaign;
  onSaved: () => Promise<void>;
}) {
  const [stateJson, setStateJson] = useState(JSON.stringify(campaign.state, null, 2));
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const savingGuard = useRef(false);
  return (
    <section className="panel stack">
      <h3>GM auxiliary state</h3>
      <ErrorNotice message={error} />
      {feedback && <small role="status">{feedback}</small>}
      <dl className="sheet-values">
        {Object.entries(campaign.state).map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd>
          </div>
        ))}
      </dl>
      <JsonEditor value={stateJson} onChange={setStateJson} label="Advanced: edit GM state JSON" />
      <button
        onClick={async () => {
          if (savingGuard.current) return;
          savingGuard.current = true;
          try {
            await request(
              `/campaigns/${campaign.id}`,
              json('PATCH', { revision: campaign.revision, state: parseObject(stateJson) })
            );
            await onSaved();
            setError('');
            setFeedback('GM state saved.');
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            savingGuard.current = false;
          }
        }}
      >
        Save GM state
      </button>
    </section>
  );
}
