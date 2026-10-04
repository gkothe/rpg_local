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
        The app sends two kinds of input. System instructions tell the model how to do the job. The
        user prompt supplies campaign data in JSON, along with the required response format
        (schema). The model also receives the allowed tool definitions and any results they return.
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
          <strong>Mira always included.</strong> The prompt includes every player sheet.
        </p>
        <p>
          <strong>{mentioned ? 'Ivo included' : 'Ivo omitted'}</strong>. Mentioning Ivo selects his
          NPC sheet in this example. In a real turn, the app also checks the saved state, pinned
          facts, and the last three completed turns that have not been undone.
        </p>
        <p>
          <strong>{pinned ? 'Pinned excerpt included' : 'Pinned excerpt omitted'}</strong>. A pinned
          excerpt enters the prompt only when its source is confirmed and its version still matches.
        </p>
        <p>
          <strong>{book ? 'Book overview included' : 'Default system context'}</strong>. Book mode
          adds a rulebook overview and makes the four book tools available.
        </p>
      </div>
      <details>
        <summary>Read the JSON user prompt and response schema</summary>
        <p>
          This example keeps the knowledge and retrieved-source lists empty to keep the scene small.
          In a real turn, the app can add relevant knowledge and source excerpts found by matching
          words. The switches above change only this example.
        </p>
        <pre aria-label="User prompt JSON">{JSON.stringify(payload, null, 2)}</pre>
      </details>
      <details>
        <summary>System instructions and the context record</summary>
        <p>
          The v4 system prompt combines the selected rule system's instructions, your campaign
          instructions, and the app's response and tool requirements. Source text and history are
          reference material, not instructions. This complete example is checked against the
          backend's prompt builder.
        </p>
        <pre aria-label="System prompt">
          {book ? systemPromptExamples.book : systemPromptExamples.default}
        </pre>
        <p>
          The app keeps a ContextManifest to record how it built the context. It contains the
          campaign revision, source versions and text ranges, history IDs, memory ID, size
          estimates, the JSON prompt, and systemPrompt. The app uses this record internally rather
          than sending the whole manifest as another part of the user prompt.
        </p>
      </details>
      <details>
        <summary>How the app chooses and summarizes information</summary>
        <p>
          The prompt includes all players, NPCs relevant to the scene, saved state, the campaign
          description, pins, relevant knowledge, and completed turns not already covered by a
          summary. The app leaves out private campaign and character notes, failed turns, and undone
          turns. Knowledge tools can still search the full copy saved for this attempt, even when
          the initial prompt contains only selected records.
        </p>
        <p>
          The app uses size estimates to guide optional source retrieval and summarizing older
          turns, also called compaction. These are planning targets, not hard prompt rejection
          limits. Summaries can lose detail, so the original turns stay stored. The provider has its
          own capacity limits. The 180-second constant in the code does not set an app-enforced
          gameplay deadline.
        </p>
      </details>
      <h2 style={{ marginTop: '1.5rem' }}>What comes back?</h2>
      <p>
        The model returns a v4 JSON proposal with the story, character and state changes,
        explanations of dice rolls, rule citations, and knowledge changes. For each new character,
        it must also state where the introduction came from. The backend checks the proposal before
        applying it.
      </p>
      <div className="flow-diff">
        <span>
          Mira's current HP <strong>{stale ? 8 : 10}</strong>
        </span>
        <span aria-hidden="true">→</span>
        <span>
          The model expects <strong>10</strong>
        </span>
        <span>
          It proposes <strong>9</strong>
        </span>
      </div>
      <label>
        <input type="checkbox" checked={stale} onChange={(e) => setStale(e.target.checked)} />
        Simulate stale prior value
      </label>
      <p role="status">
        {stale
          ? 'Rejected: the model expects HP 10, but Mira currently has 8. The app saves no gameplay change.'
          : 'Accepted example: Mira has the expected 10 HP. The app records the attributes before and after the change in a snapshot. Her private notes stay unchanged.'}
      </p>
      <details>
        <summary>Complete v4 final proposal</summary>
        <pre aria-label="Final proposal JSON">{JSON.stringify(proposal, null, 2)}</pre>
      </details>
      <details>
        <summary>What validation does and does not prove</summary>
        <p>
          The app checks the response format and IDs, expected previous values, every recorded roll
          reference, evidence for citations, and the origin of knowledge changes. It does not
          automatically judge the story's arithmetic, strategy, or interpretation of game rules.
          This example has no citations or knowledge changes, so those arrays are empty. When the
          model creates an NPC, the app also records a linked introduction in campaign knowledge.
        </p>
      </details>
    </section>
  );
}
