import { useState } from 'react';
import { tools } from './content';
import { citation } from './examples';
const traceDetails = [
  'The model requests an allowed tool and supplies its arguments. The app will run the request; the model has not queried the database or generated trusted dice itself.',
  'The tool registry checks the arguments and confirms that the turn is still active. It rejects unknown tools and runs accepted calls one at a time.',
  'The app service carries out the request. The examples below show which calls use the database and which use the fixed copy in memory.',
  'The app sends the result back through local HTTP MCP for Claude and Antigravity, or stdio tool calls for Codex. The model can then continue its response.',
  'The final proposal refers to saved rolls, rule-read receipts and prepared combatant IDs. The app still needs to check and save the gameplay changes in a separate transaction.',
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
  const npcs = tool.id.startsWith('campaign_npcs');
  return (
    <section className="flow-card" aria-label="Tool explorer">
      <h2>How the model uses tools</h2>
      <p>
        The model can ask the app for information through the allowed tools. The backend prepares
        the context and handles every service call, including database access. The model has no
        direct database connection or tool for running arbitrary SQL.
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
        {tools.filter((candidate) => bookEnabled || !candidate.bookOnly).length} available tools.
        {!bookEnabled && ' Rulebook tools require book mode.'}
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
        {npcs
          ? 'How NPC lookup works'
          : knowledge
            ? 'How knowledge lookup works'
            : tool.id === 'roll_dice'
              ? 'How a dice roll is recorded'
              : 'How the model reads a rulebook'}
      </h3>
      <div className="flow-edges" aria-label="Tool trace stages">
        {[
          'LLM request',
          'Check the request',
          'Run the tool',
          'Return the result',
          'Final proposal',
        ].map((label, i) => (
          <button key={label} aria-pressed={trace === i} onClick={() => setTrace(i)}>
            {i + 1}. {label}
          </button>
        ))}
      </div>
      <p role="status">{traceDetails[trace]}</p>
      <ol className="flow-trace">
        {npcs ? (
          <>
            <li>
              Player sheets are always supplied. NPCs mentioned in the scene can also be included
              automatically.
            </li>
            <li>
              For an older NPC absent from the prompt, search the frozen roster by name or
              description. An empty query lists it; duplicate names have separate IDs.
            </li>
            <li>
              Get returns the chosen NPC’s complete saved sheet without private notes. Knowledge
              links lead to events and relationships through the knowledge tools.
            </li>
            <li>
              The roster stays fixed for this turn and its retries. Lookup reads data; changes still
              require validated operations in the final proposal.
            </li>
          </>
        ) : knowledge ? (
          <>
            <li>
              Before calling the model, the app reads campaign knowledge from PostgreSQL and copies
              the complete set of records into the turn's session.
            </li>
            <li>
              Search and get use that fixed copy in memory. They do not query PostgreSQL again, so
              edits made after the turn starts do not change their answers.
            </li>
            <li>
              Search returns active records by default. An explicit status filter or a get request
              can retrieve resolved or retracted records too.
            </li>
            <li>
              The model proposes new or updated facts in the final knowledgeChanges field. Each
              record keeps its origin, certainty, status, and attribution history.
            </li>
          </>
        ) : tool.id === 'roll_dice' ? (
          <>
            <li>The app checks the next roll slot and which dice the model requested.</li>
            <li>
              The app uses a cryptographic random generator and saves the dice results in PostgreSQL
              before showing them to the model.
            </li>
            <li>
              A repeated request with the same dice specification reuses the saved results. The app
              rejects a changed specification.
            </li>
            <li>
              The final response must explain each recorded roll ID exactly once. The model is still
              responsible for getting the story's arithmetic right.
            </li>
          </>
        ) : (
          <>
            <li>
              Map, search, and list help the model find a rulebook section. Section lists, snippets,
              and extracted fields help with navigation; the model must read the original text
              before citing a rule.
            </li>
            <li>
              A rules_get call with view:text asks the backend for original text from the rule
              system selected for this turn.
            </li>
            <li>
              The app saves a read receipt for this turn. It records the text range, rule system ID,
              version, content hash, and page information.
            </li>
            <li>
              The final citation must quote an exact part of that text, with matching receipt and
              page information. Positions use UTF-16 offsets, as JavaScript strings do. The app
              verifies the quote but does not judge how the model interpreted it.
            </li>
          </>
        )}
      </ol>
      <details>
        <summary>Example arguments and result sent to the model</summary>
        <p>
          These are complete, made-up examples. The book examples reuse one receipt ID for
          readability; real calls each have a saved receipt. A search locator is a token for finding
          text within the session. The locator shown here is also made up.
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
        <summary>How a model corrects a tool request</summary>
        <p>
          Codex can receive an unsuccessful tool result for an invalid dice request, invalid
          argument format, missing NPC or knowledge record, or invalid search cursor. The model can
          correct the request within the same conversation using a new call ID. This does not erase
          saved dice or restart the outer response-repair counter.
        </p>
        <p>
          Antigravity must call the native call_mcp_tool gateway with ServerName:local_rpg, a
          registered ToolName, and an Arguments object. The adapter adds these instructions to the
          model prompt. Calling an allowed tool directly or sending malformed arguments is rejected
          before the tool runs and can trigger an outer repair. A completion must match a request
          the app already accepted. External tool names, changed request identities, and lost
          ownership still stop the attempt.
        </p>
      </details>
      <details>
        <summary>Tool access and request limits</summary>
        <p>
          The session disables other native tools and exposes only the app's allowed tools to the
          model. The provider's command-line process still uses authentication and inherits a
          filtered set of environment values. Restricting model tools does not remove those
          credentials from the process.
        </p>
        <p>
          The app runs tool calls one at a time. Rule calls share a cumulative SQL budget of 12
          calls and 8192 bytes; a per-call check alone does not verify how much remains. HTTP MCP
          limits arguments to 1024 bytes, including dice arguments, even though the dice validator
          allows more. Repair attempts share the accumulated tool transcript limits.
        </p>
      </details>
    </section>
  );
}
