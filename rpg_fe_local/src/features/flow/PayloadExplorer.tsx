import { useState } from 'react';
import { examplePayload, proposal } from './examples';
import { systemPromptExamples } from './systemPromptExample';
export default function PayloadExplorer() {
  const [pinned, setPinned] = useState(false),
    [mentioned, setMentioned] = useState(false),
    [book, setBook] = useState(false),
    [stale, setStale] = useState(false);
  const payload = examplePayload(pinned, mentioned, book);
  return (
    <section className="flow-card" aria-label="Payload explorer">
      <h2>What reaches the model?</h2>
      <p>
        Two separate channels: system instructions define the job; a JSON user prompt supplies
        reference data and the final-response schema. Tool definitions and later results are also
        model-visible.
      </p>
      <div className="flow-controls">
        <label>
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
          Pin confirmed source
        </label>
        <label>
          <input
            type="checkbox"
            checked={mentioned}
            onChange={(e) => setMentioned(e.target.checked)}
          />
          Mention Ivo in the action
        </label>
        <label>
          <input type="checkbox" checked={book} onChange={(e) => setBook(e.target.checked)} />
          Use book mode
        </label>
      </div>
      <div className="flow-selection" aria-live="polite">
        <p>
          <strong>Mira always included</strong> — player sheets are mandatory.
        </p>
        <p>
          <strong>{mentioned ? 'Ivo included' : 'Ivo omitted'}</strong> — this scene mention selects
          the NPC; live selection also considers state, pins and the latest three active completed
          turns.
        </p>
        <p>
          <strong>{pinned ? 'Pinned excerpt included' : 'Pinned excerpt omitted'}</strong> — only
          confirmed, correctly versioned pins enter the prompt.
        </p>
        <p>
          <strong>{book ? 'Book overview included' : 'Default system context'}</strong> — book mode
          also exposes the four rule tools.
        </p>
      </div>
      <details>
        <summary>JSON user prompt with full response schema</summary>
        <p>
          This complete illustrated payload uses empty knowledge/retrieval lists to keep the scene
          small. The live builder can add relevant knowledge and optional lexical source matches.
          These toggles edit teaching fixtures, not the production context builder.
        </p>
        <pre aria-label="User prompt JSON">{JSON.stringify(payload, null, 2)}</pre>
      </details>
      <details>
        <summary>System instructions and manifest</summary>
        <p>
          The v4 system envelope combines the integration protocol, selected system instructions and
          campaign instructions. Sources/history are reference data, never instructions. This
          complete example envelope is checked against the backend builder.
        </p>
        <pre aria-label="System prompt">
          {book ? systemPromptExamples.book : systemPromptExamples.default}
        </pre>
        <p>
          The ContextManifest is application metadata: revision, source versions/spans, history IDs,
          memory ID, estimates, serialized prompt and systemPrompt. It is not another block copied
          wholesale into the user prompt.
        </p>
      </details>
      <details>
        <summary>Included, omitted and summarized</summary>
        <p>
          Included: all players, scene NPCs, canonical state, description, pins, relevant registry
          knowledge and uncovered completed history. Omitted from automatic gameplay input: private
          campaign/character notes, failed turns and undone turns. The full knowledge registry is
          frozen for recall tools even when only selected records enter the initial prompt.
        </p>
        <p>
          Optional lexical retrieval and compaction use soft estimates, not hard prompt rejection
          limits. Compaction is lossy and keeps original transcripts. Provider-native capacity
          limits are separate; there is no application gameplay deadline guaranteed by a 180-second
          constant.
        </p>
      </details>
      <h2 style={{ marginTop: '1.5rem' }}>What comes back?</h2>
      <p>
        A v4 proposal contains narrative, character/state operations, roll interpretations, rule
        citations and knowledge changes. New characters require introduction provenance. The backend
        decides whether it can apply this proposal.
      </p>
      <div className="flow-diff">
        <span>
          Mira HP before <strong>{stale ? 8 : 10}</strong>
        </span>
        <span aria-hidden="true">→</span>
        <span>
          Proposal expects <strong>10</strong>
        </span>
        <span>
          Proposes <strong>9</strong>
        </span>
      </div>
      <label>
        <input type="checkbox" checked={stale} onChange={(e) => setStale(e.target.checked)} />
        Simulate stale prior value
      </label>
      <p role="status">
        {stale
          ? 'Rejected: expected HP 10 does not match current HP 8. No canonical update is committed.'
          : 'Accepted example: expected HP 10 matches. A snapshot records the touched attributes field; private notes stay unchanged.'}
      </p>
      <details>
        <summary>Complete v4 final proposal</summary>
        <pre aria-label="Final proposal JSON">{JSON.stringify(proposal, null, 2)}</pre>
      </details>
      <details>
        <summary>What validation does and does not prove</summary>
        <p>
          Strict shape, identity, expected prior values, every recorded roll reference, citation
          evidence and knowledge provenance are checked. Narrative arithmetic, strategic decisions
          and semantic rule correctness are not automatically proven. This example has no rule
          citation or knowledge mutation; empty arrays are valid. A created NPC also receives a
          linked knowledge introduction automatically.
        </p>
      </details>
    </section>
  );
}
