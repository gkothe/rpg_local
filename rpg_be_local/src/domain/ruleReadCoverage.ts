/** Successful originals supplied to one execution. Never infer delivery from persistence. */
export type RuleOriginalRead = Record<string, unknown>;
export type RuleDeliveredEvidence = { receiptIds: string[] };
export type RuleOwnedEvidence = RuleDeliveredEvidence & { scope: string };
export type RuleOriginalLocator = {
  receiptId: string;
  path: string;
  start: number;
  end: number;
  complete: boolean;
  nextRead: { path: string; view: 'text'; cursor: string } | null;
};
export function isRuleOriginal(read: RuleOriginalRead): boolean {
  return (
    !read.error &&
    read.view === 'text' &&
    !read.structural &&
    typeof read.text === 'string' &&
    read.text.length > 0 &&
    typeof read.receipt === 'string' &&
    typeof read.path === 'string' &&
    typeof read.revision === 'number' &&
    typeof read.contentHash === 'string' &&
    Number.isInteger(read.start) &&
    Number.isInteger(read.end) &&
    (read.start as number) >= 0 &&
    (read.end as number) > (read.start as number)
  );
}
export function originalReadLocator(read: RuleOriginalRead): RuleOriginalLocator {
  return {
    receiptId: read.receipt as string,
    path: read.path as string,
    start: read.start as number,
    end: read.end as number,
    complete: read.complete === true,
    nextRead:
      typeof read.cursor === 'string'
        ? { path: read.path as string, view: 'text', cursor: read.cursor }
        : null,
  };
}
export function ruleReadCoverage(
  entry: { path?: unknown; matchWindow?: unknown },
  revision: unknown,
  contentHash: unknown,
  reads: readonly RuleOriginalRead[]
) {
  const supplied = reads
    .filter(
      (r) =>
        isRuleOriginal(r) &&
        r.path === entry.path &&
        r.revision === revision &&
        r.contentHash === contentHash
    )
    .map(originalReadLocator);
  const whole = supplied
    .filter((s) => s.start === 0 && s.complete)
    .sort((a, b) => a.receiptId.localeCompare(b.receiptId))[0];
  const selected: RuleOriginalLocator[] = whole ? [whole] : [];
  const window = entry.matchWindow as { start?: unknown; end?: unknown } | undefined;
  let matchSupplied = !!whole;
  if (
    !whole &&
    window &&
    Number.isInteger(window.start) &&
    Number.isInteger(window.end) &&
    (window.start as number) >= 0 &&
    (window.end as number) > (window.start as number)
  ) {
    let position = window.start as number;
    while (position < (window.end as number)) {
      const next = supplied
        .filter((s) => s.start <= position && s.end > position)
        .sort((a, b) => b.end - a.end || a.receiptId.localeCompare(b.receiptId))[0];
      if (!next) break;
      selected.push(next);
      position = next.end;
    }
    matchSupplied = position >= (window.end as number);
  }
  return {
    alreadySupplied: supplied.length > 0,
    originalComplete: !!whole,
    matchSupplied,
    ...(matchSupplied ? { suppliedOriginals: selected } : {}),
  };
}
