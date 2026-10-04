import { useState } from 'react';
import { steps } from './content';
const outcomes: Record<string, string> = {
  success:
    'The app saves an accepted proposal only if the attempt still has permission to finish and the campaign version matches.',
  duplicate:
    'Sending the same requestId with the same checked data and campaign version returns the original result. Reusing that ID with different data causes a conflict.',
  invalid:
    'For some JSON, response-format, or reference errors, the app can ask the model to fix its response up to twice. That allows up to three outer calls. The model receives feedback, and the app keeps the tool records.',
  operational:
    'A quota or login problem, missing database migration, full disk, denied file access, or failed prompt-log write needs a local fix. The app reports the problem; asking the model to rewrite its response cannot fix it. If the database is unavailable, saving the failed status can fail too, and lease recovery must mark the turn interrupted later.',
  cancelled:
    'The app stops a stale result from being saved if the attempt loses permission, its lease expires, or the campaign or rules version changes. It does not ask the model to repair the story in these cases.',
  interrupted:
    'Recovery marks an expired turn interrupted and does not restart inference automatically. You can request a retry. If it is eligible, the app starts a new attempt using the unchanged original session.',
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
      <p>
        In this example, Mira crosses a damaged bridge. Use Next to follow her action through the
        system, or choose a step below.
      </p>
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
        <summary>How mode and provider change the flow</summary>
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
            ? 'Book mode has seven tools: dice, two campaign knowledge tools, and four rulebook tools.'
            : 'Default mode has three tools: dice and two campaign knowledge tools.'}
        </p>
        <p>
          {provider === 'codex'
            ? 'Codex exchanges tool messages with the app through its app-server using standard input and output (stdio).'
            : `${provider === 'claude' ? 'Claude' : 'Antigravity'} exchanges tool messages through a private local HTTP MCP server.`}{' '}
          Each provider uses its authenticated cloud service to generate the response.
        </p>
      </details>
      <details open={outcome !== 'success'}>
        <summary>What happens when something goes wrong?</summary>
        <label>
          What if…
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="success">Success</option>
            <option value="duplicate">Duplicate request</option>
            <option value="invalid">Invalid response</option>
            <option value="operational">Account, database, or file problem</option>
            <option value="cancelled">Ownership / revision changed</option>
            <option value="interrupted">Interrupted process</option>
          </select>
        </label>
        <p>{outcomes[outcome]}</p>
      </details>
    </section>
  );
}
