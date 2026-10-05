import type { ResponsePath } from '../domain/responseFields.js';

type Row = Record<string, unknown>;
const asRow = (value: unknown): Row | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : undefined;
const evidenceCollections = [
  'sourceSpans',
  'ruleReads',
  'characters',
  'knowledge',
  'rolls',
] as const;

/** Select only explicit dependencies; unresolved references retain the complete evidence bundle. */
export function selectRepairEvidence(response: unknown, paths: ResponsePath[], evidence: unknown) {
  const fallbackReasons = new Set<string>();
  const candidate = asRow(response);
  const bundle = asRow(evidence);
  const broad = (reason: string) => ({
    evidence,
    mode: 'full' as const,
    fallbackReasons: [...fallbackReasons, reason],
  });
  if (!candidate || !bundle || evidenceCollections.some((key) => !Array.isArray(bundle[key])))
    return broad('unrecognized_evidence_bundle');

  const selected = Object.fromEntries(
    evidenceCollections.map((key) => [key, new Set<unknown>()])
  ) as Record<(typeof evidenceCollections)[number], Set<unknown>>;
  let includeState = false;
  const visited = new Set<unknown>();
  const operations = Array.isArray(candidate.operations) ? candidate.operations : [];
  const explanations = Array.isArray(candidate.operationExplanations)
    ? candidate.operationExplanations
    : [];
  const find = (key: (typeof evidenceCollections)[number], matches: (row: Row) => boolean) => {
    const rows = (bundle[key] as unknown[]).filter((value) => {
      const row = asRow(value);
      return row && matches(row);
    });
    if (!rows.length) fallbackReasons.add(`unresolved_${key}_reference`);
    for (const row of rows) selected[key].add(row);
  };
  const character = (id: unknown) => {
    if (typeof id === 'string') find('characters', (row) => row.id === id);
    else if (id !== null && id !== undefined) visit(id);
  };
  const operation = (index: unknown) => {
    if (!Number.isInteger(index) || !operations[index as number]) {
      fallbackReasons.add('unresolved_operation_reference');
      return;
    }
    visit(operations[index as number]);
    for (const explanation of explanations) {
      if (asRow(explanation)?.operationIndex === index) visit(explanation);
    }
  };
  const visit = (value: unknown): void => {
    if (visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const row = asRow(value);
    if (!row) return;
    if (row.op === 'set' && typeof row.characterId !== 'string')
      fallbackReasons.add('incomplete_character_reference');
    if (row.type === 'book' && !asRow(row.citation))
      fallbackReasons.add('incomplete_rule_reference');
    if (row.type === 'campaign_source') {
      if (typeof row.sourceId !== 'string' || !Number.isInteger(row.version))
        fallbackReasons.add('incomplete_source_reference');
      else find('sourceSpans', (span) => span.id === row.sourceId && span.version === row.version);
    }
    if ('receiptId' in row) {
      if (typeof row.receiptId !== 'string') fallbackReasons.add('incomplete_rule_reference');
      else find('ruleReads', (read) => read.id === row.receiptId);
    } else if ('citation' in row || ('quote' in row && 'path' in row)) {
      // A missing or forged receipt cannot be narrowed reliably by text alone.
      const citation = asRow(row.citation) ?? row;
      if (typeof citation.receiptId !== 'string') fallbackReasons.add('incomplete_rule_reference');
    }
    if ('rollId' in row) {
      if (typeof row.rollId !== 'string') fallbackReasons.add('incomplete_roll_reference');
      else find('rolls', (roll) => roll.id === row.rollId);
    }
    if (Array.isArray(row.rollIds))
      for (const id of row.rollIds) find('rolls', (roll) => roll.id === id);
    if ('characterId' in row) character(row.characterId);
    if (Array.isArray(row.characterIds)) for (const id of row.characterIds) character(id);
    if ('holderId' in row) character(row.holderId);
    if (['update', 'reveal', 'retract', 'resolve'].includes(String(row.op))) {
      if (typeof row.id === 'string') find('knowledge', (record) => record.id === row.id);
      else fallbackReasons.add('incomplete_knowledge_reference');
    }
    if (row.op === 'state') includeState = true;
    if ('operationIndex' in row) operation(row.operationIndex);
    if (
      (row.origin === 'source' || row.basis === 'source' || row.basis === 'rule') &&
      (!Array.isArray(row.evidence) || !row.evidence.length)
    )
      fallbackReasons.add('missing_required_evidence');
    for (const child of Object.values(row)) visit(child);
  };

  for (const path of paths) {
    const [field, index] = path;
    const collection = candidate[String(field)];
    if (!Array.isArray(collection) || typeof index !== 'number' || !collection[index])
      return broad('collection_or_missing_item');
    const item = collection[index];
    if (!asRow(item)) return broad('unrecognized_item');
    visit(item);
    if (field === 'operations') {
      operation(index);
      // Expected values may reflect earlier mutations in the same candidate.
      const id = asRow(item)?.characterId;
      for (let prior = 0; prior < index; prior++) {
        const row = asRow(operations[prior]);
        if ((id && row?.characterId === id) || row?.op === 'state') operation(prior);
      }
    }
    if (field === 'rollInterpretations' && typeof asRow(item)?.rollId !== 'string')
      fallbackReasons.add('incomplete_roll_reference');
    if (field === 'ruleCitations' && typeof asRow(item)?.receiptId !== 'string')
      fallbackReasons.add('incomplete_rule_reference');
  }
  if (fallbackReasons.size)
    return { evidence, mode: 'full' as const, fallbackReasons: [...fallbackReasons] };
  return {
    evidence: {
      ...Object.fromEntries(evidenceCollections.map((key) => [key, [...selected[key]]])),
      ...(includeState ? { state: bundle.state } : {}),
    },
    mode: 'selected' as const,
    fallbackReasons: [],
  };
}
