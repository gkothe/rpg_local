import {
  RULE_COLUMNS,
  RULE_LIMITS,
  serializedBytes,
  type RuleContent,
  type RuleNode,
} from './rules.js';
export type RuleMapping = {
  authority: string;
  columns: {
    column: string;
    books: string[];
    nodes: number;
    fields: string[];
    fieldsOmitted: boolean;
  }[];
  layout: string;
};
export function generateRuleMapping(content: RuleContent): {
  mapping: RuleMapping;
  overview: string;
} {
  const columns: RuleMapping['columns'] = [];
  for (const column of RULE_COLUMNS) {
    let count = 0;
    const fields = new Set<string>();
    let fieldsOmitted = false;
    function visit(node: RuleNode) {
      count++;
      for (const key of Object.keys(node.fields ?? {})) {
        if (fields.has(key)) continue;
        if (
          fields.size < RULE_LIMITS.mappingFieldsPerColumn &&
          serializedBytes([...fields, key]) <= RULE_LIMITS.mappingFieldBytesPerColumn
        )
          fields.add(key);
        else fieldsOmitted = true;
      }
      for (const child of Object.values(node.children)) visit(child);
    }
    for (const node of Object.values(content[column])) visit(node);
    if (count)
      columns.push({
        column,
        books: Object.keys(content[column]).sort(),
        nodes: count,
        fields: [...fields].sort(),
        fieldsOmitted,
      });
  }
  const mapping: RuleMapping = {
    authority:
      'Original direct text is authoritative. Summaries and extracted fields are derived navigation only.',
    layout:
      'column.book.node.children.child; each node has name, aliases, source, direct text, optional summary/fields/evidence, review, pages and children. Discover paths using search/list.',
    columns,
  };
  if (serializedBytes(mapping) > RULE_LIMITS.mappingBytes)
    throw new Error('Generated mapping exceeds byte limit');
  const overview =
    'Available book content. ' +
    'Populated columns: ' +
    columns.map((entry) => entry.column).join(', ') +
    '. Nodes provide direct text, optional summaries/fields and page metadata; rules_map/search/list locate paths and rules_get returns node content.';
  if (Buffer.byteLength(overview, 'utf8') > RULE_LIMITS.overviewBytes)
    throw new Error('Generated overview exceeds byte limit');
  return { mapping, overview };
}
