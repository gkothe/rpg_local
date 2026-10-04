import type { FlowItem } from './types';
import type { Ref } from 'react';
export default function FlowInspector({
  item,
  onSection,
  ref,
  onReturn,
}: {
  item: FlowItem;
  onSection: (section: string) => void;
  ref?: Ref<HTMLElement>;
  onReturn?: () => void;
}) {
  return (
    <aside ref={ref} className="flow-card flow-inspector" aria-label="Selected detail">
      {onReturn && (
        <button className="flow-return" onClick={onReturn}>
          Back to explorer ↑
        </button>
      )}
      <div className="flow-kicker">How this part works</div>
      <h2 tabIndex={-1}>{item.label}</h2>
      <p>{item.summary}</p>
      <dl>
        <dt>When it runs</dt>
        <dd>{item.timing}</dd>
        <dt>Receives</dt>
        <dd>{item.input}</dd>
        <dt>Returns or sends</dt>
        <dd>{item.output}</dd>
        <dt>What it reads and saves</dt>
        <dd>{item.storage}</dd>
      </dl>
      {item.detail && (
        <details>
          <summary>Checks and limits</summary>
          <p>{item.detail}</p>
        </details>
      )}
      <details>
        <summary>Source code and documentation</summary>
        <button onClick={() => onSection(item.section)}>
          Read document section {item.section}
        </button>
        <ul className="flow-evidence">
          {item.sources.map((source) => (
            <li key={source}>{source}</li>
          ))}
        </ul>
      </details>
    </aside>
  );
}
