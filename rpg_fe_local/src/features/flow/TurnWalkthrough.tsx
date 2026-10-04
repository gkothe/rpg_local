import { useState } from 'react';
import { steps } from './content';
const outcomes: Record<string, string> = {
  success:
    'The accepted proposal commits only while the turn still owns its lease and campaign revision.',
  duplicate:
    'The same requestId and parsed payload/revision replay the original outcome. A changed payload with the same identity conflicts.',
  invalid:
    'Eligible schema/JSON/reference errors may receive two automatic repair retries (up to three outer calls). The model receives corrective feedback; tool audit remains.',
  cancelled:
    'Lost ownership, lease expiry or a changed campaign/rule revision prevents a stale commit. This is not a semantic narrative repair.',
  interrupted:
    'Recovery marks an expired turn interrupted; it does not restart inference automatically. Explicit retry creates a new turn attempt and reuses an eligible unchanged frozen session.',
};
export default function TurnWalkthrough({
  step,
  onStep,
}: {
  step: string;
  onStep: (id: string) => void;
}) {
  const [outcome, setOutcome] = useState('success');
  const [provider, setProvider] = useState('claude');
  const [book, setBook] = useState(false);
  const index = Math.max(
    0,
    steps.findIndex((s) => s.id === step)
  );
  return (
    <section className="flow-card" aria-label="Guided turn">
      <h2>Follow one action</h2>
      <p>A scripted example: Mira crosses a damaged bridge. Move at your own pace.</p>
      <div className="flow-controls">
        <label>
          Jump to step
          <select value={steps[index].id} onChange={(e) => onStep(e.target.value)}>
            {steps.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flow-progress" aria-hidden="true">
        {steps.map((s, i) => (
          <span key={s.id} data-active={i <= index} />
        ))}
      </div>
      <div className="flow-step" role="status">
        <h3>{steps[index].label}</h3>
        <p>{steps[index].data}</p>
      </div>
      <div className="flow-controls">
        <button disabled={index === 0} onClick={() => onStep(steps[index - 1].id)}>
          Previous
        </button>
        <button disabled={index === steps.length - 1} onClick={() => onStep(steps[index + 1].id)}>
          Next
        </button>
        <button onClick={() => onStep(steps[0].id)}>Reset</button>
      </div>
      <details>
        <summary>Mode and provider boundaries</summary>
        <div className="flow-controls">
          <label>
            <input type="checkbox" checked={book} onChange={(e) => setBook(e.target.checked)} />
            Book mode
          </label>
          <label>
            Provider
            <select value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="claude">Claude</option>
              <option value="codex">Codex</option>
              <option value="antigravity">Antigravity</option>
            </select>
          </label>
        </div>
        <p>
          {book
            ? 'Seven tools: trusted dice, two knowledge tools and four book tools.'
            : 'Three tools: trusted dice and two campaign knowledge tools.'}
        </p>
        <p>
          {provider === 'codex'
            ? 'Codex: stdio app-server with owned dynamic tool calls.'
            : `${provider === 'claude' ? 'Claude' : 'Antigravity'}: private loopback HTTP MCP for owned tools.`}{' '}
          The provider model runs through authenticated cloud services.
        </p>
      </details>
      <details open={outcome !== 'success'}>
        <summary>Failure, repair and retry branches</summary>
        <label>
          What if…
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="success">Success</option>
            <option value="duplicate">Duplicate request</option>
            <option value="invalid">Invalid response</option>
            <option value="cancelled">Ownership / revision changed</option>
            <option value="interrupted">Interrupted process</option>
          </select>
        </label>
        <p>{outcomes[outcome]}</p>
      </details>
    </section>
  );
}
