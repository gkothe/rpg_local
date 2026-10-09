import type { SheetLayout } from '../../services/types';
import CharacterData from './CharacterData';
import SheetItems from './SheetItems';
import { valueAt, type ItemDelete, type ItemSave } from './itemValues';
import { buildSheetModel, type SheetNode } from './sheetModel';

const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max));
const signed = (value: number) => (value > 0 ? `+${value}` : String(value));

function Pips({
  node,
  shape,
}: {
  node: SheetNode & { value: number; max: number };
  shape: string;
}) {
  const filled = clamp(Math.floor(node.value), node.max);
  return (
    <span
      className={`sheet-pips sheet-${shape}`}
      role="img"
      aria-label={`${node.label} ${node.value} of ${node.max}`}
    >
      {Array.from({ length: node.max }, (_, index) => (
        <span key={index} className={index < filled ? 'on' : ''} aria-hidden="true" />
      ))}
    </span>
  );
}

function Value({
  node,
  sections,
  onSave,
  onDelete,
}: {
  node: SheetNode;
  sections: Record<string, unknown>;
  onSave?: ItemSave;
  onDelete?: ItemDelete;
}) {
  switch (node.kind) {
    case 'number':
      return <span className="character-value sheet-number">{node.value}</span>;
    case 'dots':
      return <Pips node={node} shape="dots" />;
    case 'checks':
      return <Pips node={node} shape="checks" />;
    case 'track':
      return (
        <span className="sheet-track">
          <span
            className="sheet-track-bar"
            role="meter"
            aria-label={node.label}
            aria-valuemin={0}
            aria-valuemax={node.max}
            aria-valuenow={clamp(node.value, node.max)}
            aria-valuetext={`${node.value} of ${node.max}`}
          >
            <span
              style={{
                width: `${node.max > 0 ? (clamp(node.value, node.max) / node.max) * 100 : 0}%`,
              }}
            />
          </span>
          <span className="sheet-track-text">
            {node.value} / {node.max}
          </span>
        </span>
      );
    case 'percentile':
      return (
        <span className="sheet-percentile">
          <span className="character-value sheet-number">{node.value}</span>
          <span className="sheet-percentile-bar" aria-hidden="true">
            <span style={{ width: `${clamp(node.value, 100)}%` }} />
          </span>
        </span>
      );
    case 'score':
      return (
        <span className="sheet-score">
          <span className="character-value sheet-number">{node.value}</span>
          {node.modifier !== null && (
            <span className="sheet-modifier" aria-label={`modifier ${signed(node.modifier)}`}>
              {signed(node.modifier)}
            </span>
          )}
        </span>
      );
    case 'text':
      return <span className="character-value">{node.text}</span>;
    case 'prose':
      return (
        <p className="sheet-prose" style={{ whiteSpace: 'pre-line' }}>
          {node.text}
        </p>
      );
    case 'tags':
      return node.values.length ? (
        <ul className="sheet-tags">
          {node.values.map((value, index) => (
            <li key={index}>{value}</li>
          ))}
        </ul>
      ) : (
        <span className="muted">Nothing recorded.</span>
      );
    case 'items':
      return (
        <SheetItems
          items={node.items}
          path={node.path ?? []}
          source={valueAt(sections, node.path ?? [])}
          onSave={onSave}
          onDelete={onDelete}
        />
      );
    case 'group':
      return (
        <Nodes nodes={node.children} sections={sections} onSave={onSave} onDelete={onDelete} />
      );
    case 'empty':
      return <span className="muted">{node.text}</span>;
    case 'raw':
      return <CharacterData value={node.value} />;
  }
}

function Nodes({
  nodes,
  sections,
  onSave,
  onDelete,
}: {
  nodes: SheetNode[];
  sections: Record<string, unknown>;
  onSave?: ItemSave;
  onDelete?: ItemDelete;
}) {
  return (
    <div className="sheet-nodes">
      {nodes.map((node) => (
        <div
          key={node.key}
          className={`sheet-field sheet-kind-${node.kind}${node.kind === 'group' ? ' nested' : ''}`}
        >
          <span className="sheet-label">{node.label}</span>
          <div className="sheet-value">
            <Value node={node} sections={sections} onSave={onSave} onDelete={onDelete} />
            {node.mismatch && (
              <small className="muted sheet-note">Layout hint does not fit this value.</small>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Renders one character section: safe structural widgets plus the rule system's layout hints. */
export default function SheetView({
  section,
  sections,
  layout,
  onSave,
  onDelete,
}: {
  section: string;
  sections: Record<string, unknown>;
  layout?: SheetLayout;
  onSave?: ItemSave;
  onDelete?: ItemDelete;
}) {
  const nodes = buildSheetModel(section, sections, layout);
  if (!nodes.length) return <p className="muted">Nothing recorded.</p>;
  return <Nodes nodes={nodes} sections={sections} onSave={onSave} onDelete={onDelete} />;
}
