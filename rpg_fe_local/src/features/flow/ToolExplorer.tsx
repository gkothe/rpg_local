import { useState } from 'react';
import { tools } from './content';
import { citation } from './examples';
const traceDetails = [
  'The LLM emits an allowed tool name and structured arguments; it has not run SQL or generated trusted dice itself.',
  'The owned registry validates the tool schema, serializes dispatch and checks turn activity. Unknown tools are rejected.',
  'The app service performs the permitted operation. Each path below has a different persistence boundary.',
  'The app returns a bounded result through HTTP MCP (Claude/Antigravity) or stdio dynamic calls (Codex). The model resumes reasoning.',
  'The final v4 proposal references recorded rolls or text receipts. Gameplay changes still require separate validation and atomic commit.',
];
export default function ToolExplorer({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [book, setBook] = useState(() => tools.find((t) => t.id === selected)?.bookOnly ?? false);
  const [trace, setTrace] = useState(0);
  const tool = tools.find((t) => t.id === selected) ?? tools[0];
  const bookEnabled = book || tool.bookOnly;
  const knowledge = tool.id.startsWith('campaign_knowledge');
  return (
    <section className="flow-card" aria-label="Tool explorer">
      <h2>The model asks. The app executes.</h2>
      <p>
        Can the LLM consult our DB? It can request allowed information through app-owned tools. It
        receives no arbitrary SQL tool or database connection. The backend prepares context and
        controls each service call.
      </p>
      <label>
        <input
          type="checkbox"
          checked={bookEnabled}
          onChange={(e) => {
            setBook(e.target.checked);
            if (!e.target.checked && tool.bookOnly) onSelect('roll_dice');
          }}
        />
        Enable book tools
      </label>
      <p>
        {bookEnabled
          ? '7 available tools'
          : '3 available tools — four book tools require book mode'}
      </p>
      <div className="flow-tool-list">
        {tools.map((t) => (
          <button
            key={t.id}
            disabled={t.bookOnly && !bookEnabled}
            aria-pressed={t.id === tool.id}
            onClick={() => {
              onSelect(t.id);
              setTrace(0);
            }}
          >
            {t.label}
            <small>{t.bookOnly ? 'Book mode' : 'Default + book mode'}</small>
          </button>
        ))}
      </div>
      <h3 style={{ marginTop: '1.5rem' }}>
        {knowledge
          ? 'Frozen knowledge trace'
          : tool.id === 'roll_dice'
            ? 'Persisted dice trace'
            : 'Original book trace'}
      </h3>
      <div className="flow-edges" aria-label="Tool trace stages">
        {[
          'LLM request',
          'Validate / dispatch',
          'Service boundary',
          'Return / resume',
          'Final proposal',
        ].map((label, i) => (
          <button key={label} aria-pressed={trace === i} onClick={() => setTrace(i)}>
            {i + 1}. {label}
          </button>
        ))}
      </div>
      <p role="status">{traceDetails[trace]}</p>
      <ol className="flow-trace">
        {knowledge ? (
          <>
            <li>
              Context preparation reads campaign knowledge from PostgreSQL and clones the complete
              registry into the session.
            </li>
            <li>
              Search/get consult that frozen registry. No SQL is executed by this recall call; edits
              made later do not change its answers.
            </li>
            <li>
              Search defaults to active records; explicit status/get can retrieve older resolved or
              retracted information.
            </li>
            <li>
              New or updated facts go in final knowledgeChanges, preserving origin, certainty,
              lifecycle and attribution.
            </li>
          </>
        ) : tool.id === 'roll_dice' ? (
          <>
            <li>The app validates the next slot and dice specification.</li>
            <li>
              Cryptographic faces are generated and persisted in PostgreSQL before the tool reveals
              them.
            </li>
            <li>A matching replay reuses recorded faces. A changed specification is rejected.</li>
            <li>
              The final response must interpret exactly every recorded roll ID. Narrative arithmetic
              remains the model’s responsibility.
            </li>
          </>
        ) : (
          <>
            <li>
              Map/search/list locate a candidate path; navigation, snippets and extracted fields are
              not citable ruling authority.
            </li>
            <li>
              rules_get with view:text reads original book text through the backend’s captured rule
              system.
            </li>
            <li>
              A current-turn receipt persists the text range, rule identity/revision/hash and page
              provenance.
            </li>
            <li>
              The final citation quotes an exact UTF-16 substring with matching receipt identity and
              page coverage. It proves the quote, not its interpretation.
            </li>
          </>
        )}
      </ol>
      <details>
        <summary>Example arguments and model-visible result</summary>
        <p>
          Complete synthetic examples. Each independent book example uses the same illustrative
          receipt ID; a real call has its own persisted receipt. Search locators are opaque session
          tokens; the displayed locator is synthetic.
        </p>
        <h4>Arguments</h4>
        <pre>{JSON.stringify(tool.args, null, 2)}</pre>
        <h4>Result returned to model</h4>
        <pre>{JSON.stringify(tool.result, null, 2)}</pre>
        {tool.id === 'rules_get' && (
          <>
            <h4>Final ruleCitations entry</h4>
            <pre>{JSON.stringify(citation, null, 2)}</pre>
          </>
        )}
      </details>
      <details>
        <summary>Process and transport limits</summary>
        <p>
          These sessions disable native ambient tools. The CLI still uses provider authentication
          and a filtered inherited process environment; this is not a proof that the process has no
          credentials. The model interface exposes only the allowed application tools.
        </p>
        <p>
          Tool dispatch is sequential. Rule SQL budgets are cumulative (12 calls / 8192 bytes); a
          service’s per-call check does not by itself prove remaining cumulative allowance. HTTP MCP
          limits arguments to 1024 bytes, including dice arguments, despite the larger dice domain
          cap. Repairs keep cumulative tool transcript limits.
        </p>
      </details>
    </section>
  );
}
