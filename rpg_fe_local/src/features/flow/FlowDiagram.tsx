import { edges, nodes } from './content';
const paths: Record<string, string> = {
  request: 'M180 60 H207',
  dispatch: 'M390 60 H417',
  prepare: 'M510 120 V157',
  prompt: 'M420 220 H393',
  call: 'M210 210 H183',
  result: 'M180 230 H207',
  proposal: 'M300 280 V317',
  write: 'M390 380 H417',
  refresh: 'M570 440 V470 H5 V60 H15',
  dbread: 'M90 320 V140 H480 V157',
  dbtool: 'M90 280 V317',
  dbwrite: 'M510 440 V455 H90 V442',
};
const captions: Record<string, string> = {
  browser: 'Action + revision + requestId',
  api: 'Access and request checks',
  turn: 'Owner, lease, idempotency',
  context: 'Select data; freeze session',
  model: 'Cloud inference via local CLI',
  tools: 'Request → app → result',
  validate: 'Schema, evidence, expected values',
  commit: 'Accepted diff + snapshot',
  database: 'App-owned reads and writes',
};
export default function FlowDiagram({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="flow-card flow-map" aria-label="System map">
      <h2>The round trip</h2>
      <p>
        Choose an actor or a connection. Solid arrows carry the turn; dashed arrows show storage
        access and the browser refresh. The tool loop returns to the model.
      </p>
      <div className="flow-canvas">
        <svg viewBox="0 0 600 480" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <marker
              id="flow-arrow"
              markerWidth="6"
              markerHeight="6"
              refX="5"
              refY="3"
              orient="auto"
            >
              <path d="M0,0 L6,3 L0,6" fill="currentColor" />
            </marker>
          </defs>
          {edges.map((edge) => (
            <path
              key={edge.id}
              d={paths[edge.id]}
              fill="none"
              stroke="currentColor"
              strokeWidth={selected === edge.id ? 3 : 1.5}
              opacity={
                selected === edge.id || edge.from === selected || edge.to === selected ? 1 : 0.45
              }
              strokeDasharray={
                edge.id.startsWith('db') || edge.id === 'refresh' ? '5 4' : undefined
              }
              markerEnd="url(#flow-arrow)"
            />
          ))}
        </svg>
        <ol className="flow-nodes">
          {nodes.map((node, i) => (
            <li key={node.id} data-node={node.id}>
              <button aria-pressed={selected === node.id} onClick={() => onSelect(node.id)}>
                <span className="flow-node-number">
                  {node.id === 'database' ? 'STORAGE' : String(i + 1).padStart(2, '0')}
                </span>
                <strong>{node.label}</strong>
                <small>{captions[node.id]}</small>
              </button>
            </li>
          ))}
        </ol>
      </div>
      <h3>Information connections</h3>
      <div className="flow-edges">
        {edges.map((edge) => (
          <button
            key={edge.id}
            aria-pressed={selected === edge.id}
            onClick={() => onSelect(edge.id)}
          >
            {edge.label} →
          </button>
        ))}
      </div>
    </section>
  );
}
