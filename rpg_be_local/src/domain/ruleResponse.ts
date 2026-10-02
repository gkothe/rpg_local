import { z } from 'zod';
import { Problem } from '../errors.js';
import { diceResponseSchema, diceResponseJsonSchema } from './diceResponse.js';
import { RULE_GAMEPLAY_RESPONSE_SCHEMA_VERSION } from './versions.js';
import {
  RULE_LIMITS,
  RuleSystemKind,
  ruleCitationSchema,
  rulePageSpanSchema,
  type RuleRead,
  type RuleContext,
} from './rules.js';
export const ruleResponseSchema = diceResponseSchema
  .extend({
    version: z.literal(RULE_GAMEPLAY_RESPONSE_SCHEMA_VERSION),
    ruleCitations: z.array(ruleCitationSchema).max(RULE_LIMITS.calls),
  })
  .strict();
export const ruleResponseJsonSchema = z.toJSONSchema(ruleResponseSchema);
export type RuleResponse = z.infer<typeof ruleResponseSchema>;
export const gameplayResponseContract = (context?: RuleContext) =>
  context?.kind === RuleSystemKind.Library
    ? { schema: ruleResponseSchema, jsonSchema: ruleResponseJsonSchema }
    : { schema: diceResponseSchema, jsonSchema: diceResponseJsonSchema };
export function validateRuleCitations(
  response: RuleResponse,
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
      read.context.systemId !== context.systemId ||
      read.context.revision !== context.revision ||
      read.context.contentHash !== context.contentHash
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
      citation.revision !== context.revision ||
      citation.contentHash !== context.contentHash ||
      citation.start < payload.start ||
      citation.end > payload.end ||
      payload.text.slice(citation.start - payload.start, citation.end - payload.start) !==
        citation.quote
    )
      invalid();
    const spans = z
      .array(rulePageSpanSchema)
      .parse(payload.pageSpans ?? [])
      .filter((span) => span.start < citation.end && span.end > citation.start);
    let covered = citation.start;
    for (const span of spans) {
      if (span.start > covered || span.pdfPage === null) break;
      covered = Math.max(covered, span.end);
    }
    const exact = covered >= citation.end;
    const pages = payload.pages as {
      precision: string;
      pdfPages: number[];
      printedPages: string[];
    };
    const expected = exact
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
    if (
      citation.precision !== expected.precision ||
      JSON.stringify(citation.pdfPages) !== JSON.stringify(expected.pdfPages) ||
      JSON.stringify(citation.printedPages) !== JSON.stringify(expected.printedPages)
    )
      invalid();
  }
}
