import { z } from 'zod';
import { Problem } from '../errors.js';
import { rulePageSpanSchema, type RuleCitation, type RuleRead, type RuleContext } from './rules.js';
export function validateRuleCitations(
  response: { ruleCitations: readonly RuleCitation[] },
  reads: readonly RuleRead[],
  campaignId: string,
  turnId: string,
  context: RuleContext
): void {
  const invalid = () => {
    throw new Problem(
      502,
      'rules_citations_invalid',
      'Citations must identify retrieved original text, captured rules and correct page provenance'
    );
  };
  for (const citation of response.ruleCitations) {
    const read = reads.find((entry) => entry.id === citation.receiptId);
    if (
      !read ||
      read.campaignId !== campaignId ||
      read.turnId !== turnId ||
      read.tool !== 'rules_get' ||
      read.context.systemId !== context.systemId
    )
      invalid();
    const receipt = read!;
    const payload = receipt.payload;
    if (
      payload.view !== 'text' ||
      payload.structural ||
      typeof payload.text !== 'string' ||
      typeof payload.start !== 'number' ||
      typeof payload.end !== 'number' ||
      citation.path !== payload.path ||
      citation.source !== payload.source ||
      citation.systemId !== context.systemId ||
      citation.revision !== receipt.context.revision ||
      citation.contentHash !== receipt.context.contentHash ||
      citation.start < payload.start ||
      citation.end > payload.end ||
      payload.text.slice(citation.start - payload.start, citation.end - payload.start) !==
        citation.quote
    )
      invalid();
    const expected = citationPages(payload, citation.start, citation.end);
    if (
      citation.precision !== expected.precision ||
      JSON.stringify(citation.pdfPages) !== JSON.stringify(expected.pdfPages) ||
      JSON.stringify(citation.printedPages) !== JSON.stringify(expected.printedPages)
    )
      invalid();
  }
}

export function citationPages(payload: RuleRead['payload'], start: number, end: number) {
  const spans = z
    .array(rulePageSpanSchema)
    .parse(payload.pageSpans ?? [])
    .filter((span) => span.start < end && span.end > start);
  let covered = start;
  for (const span of spans) {
    if (span.start > covered || span.pdfPage === null) break;
    covered = Math.max(covered, span.end);
  }
  const exact = covered >= end;
  const pages = payload.pages as {
    precision: string;
    pdfPages: number[];
    printedPages: string[];
  };
  return exact
    ? {
        precision: 'exact',
        pdfPages: [
          ...new Set(spans.flatMap((span) => (span.pdfPage === null ? [] : [span.pdfPage]))),
        ],
        printedPages: [
          ...new Set(
            spans.flatMap((span) => (span.printedPage === null ? [] : [span.printedPage]))
          ),
        ],
      }
    : {
        precision: pages?.precision === 'approximate' ? 'approximate' : 'unknown',
        pdfPages: pages?.pdfPages ?? [],
        printedPages: pages?.printedPages ?? [],
      };
}
