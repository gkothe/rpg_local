/** Visit only citation contract fields, never arbitrary character/state objects. */
export function mapResponseCitations(
  raw: unknown,
  visit: (value: Record<string, unknown>, book: boolean, path: (string | number)[]) => void
): unknown {
  const copy = structuredClone(raw);
  if (!copy || typeof copy !== 'object') return copy;
  const response = copy as Record<string, unknown>;
  const evidence = (value: unknown, path: (string | number)[]) => {
    if (!Array.isArray(value)) return;
    value.forEach((item, index) => {
      if (!item || typeof item !== 'object') return;
      if (item.type === 'campaign_source') visit(item, false, [...path, index]);
      if (item.type === 'book' && item.citation && typeof item.citation === 'object')
        visit(item.citation, true, [...path, index, 'citation']);
    });
  };
  if (Array.isArray(response.ruleCitations))
    response.ruleCitations.forEach((value, index) => {
      if (value && typeof value === 'object') visit(value, true, ['ruleCitations', index]);
    });
  for (const key of ['knowledgeChanges', 'operationExplanations', 'continuityChanges']) {
    if (Array.isArray(response[key]))
      response[key].forEach((item, index) => evidence(item?.evidence, [key, index, 'evidence']));
  }
  if (Array.isArray(response.operations))
    response.operations.forEach((item, index) => {
      if (item?.op === 'create')
        evidence(item.introduction?.evidence, ['operations', index, 'introduction', 'evidence']);
    });
  return copy;
}
/** Temporary values satisfy the shape parser; only receipt binding can make them authoritative. */
export function prepareCitationInput(raw: unknown): unknown {
  return mapResponseCitations(raw, (citation, book) => {
    citation.start = 0;
    citation.end = typeof citation.quote === 'string' ? citation.quote.length : 1;
    if (book) {
      citation.precision = 'unknown';
      citation.pdfPages = [];
      citation.printedPages = [];
    }
  });
}
export function citationWireSchema(schema: unknown): unknown {
  const copy = structuredClone(schema);
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    const props = node.properties as Record<string, unknown> | undefined;
    if (props?.quote && (props.receiptId || props.sourceId)) {
      const computed = [
        'start',
        'end',
        ...(props.receiptId ? ['precision', 'pdfPages', 'printedPages'] : []),
      ];
      if (Array.isArray(node.required))
        node.required = node.required.filter((field) => !computed.includes(field));
      node.description =
        'Provide an exact quote and source identity. The application calculates offsets and page metadata.';
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(walk);
      else walk(child);
    }
  };
  walk(copy);
  return copy;
}
