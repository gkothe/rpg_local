import { Problem } from '../errors.js';
import { mapResponseCitations } from './citationInput.js';
import {
  ResponseFieldProblem,
  ResponseFieldProblems,
  type ResponsePath,
} from './responseFields.js';
import { citationPages } from './ruleCitationValidation.js';
import type { KnowledgeValidation } from './knowledge.js';
import type { GameplayResponse } from './gameplayResponse.js';

function occurrences(text: string, quote: string, base: number): number[] {
  const result: number[] = [];
  if (!quote) return result;
  for (let index = text.indexOf(quote); index !== -1; index = text.indexOf(quote, index + 1))
    result.push(base + index);
  return result;
}
/** Bind exact quotes only to source material actually supplied in this frozen turn. */
export function bindResponseCitations<T extends GameplayResponse>(
  response: T,
  context: KnowledgeValidation
): T {
  const problems: ResponseFieldProblem[] = [];
  const bind = (citation: Record<string, unknown>, book: boolean, path: ResponsePath) => {
    const invalid = (message: string): never => {
      throw new ResponseFieldProblem(path, new Problem(502, 'citation_binding', message));
    };
    const quote = citation.quote as string;
    let starts: number[];
    if (book) {
      const read = context.ruleReads?.find((entry) => entry.id === citation.receiptId);
      const captured = context.ruleContext;
      if (
        !read ||
        !captured ||
        read.campaignId !== context.campaignId ||
        read.turnId !== context.turnId ||
        read.tool !== 'rules_get' ||
        read.context.systemId !== captured.systemId ||
        citation.systemId !== captured.systemId ||
        citation.revision !== read.context.revision ||
        citation.contentHash !== read.context.contentHash ||
        read.payload.view !== 'text' ||
        read.payload.structural ||
        read.payload.path !== citation.path ||
        read.payload.source !== citation.source ||
        typeof read.payload.text !== 'string' ||
        typeof read.payload.start !== 'number'
      ) {
        invalid(
          'Book evidence must identify an owned text receipt and the captured library identity.'
        );
      }
      starts = occurrences(read!.payload.text as string, quote, read!.payload.start as number);
      if (starts.length !== 1)
        invalid(
          'Book quote must occur exactly once in its retrieved text; use a longer exact quote if ambiguous.'
        );
      citation.start = starts[0]!;
      citation.end = starts[0]! + quote.length;
      Object.assign(citation, citationPages(read!.payload, starts[0]!, citation.end as number));
    } else {
      const spans = (context.sourceSpans ?? []).filter(
        (span) =>
          span.id === citation.sourceId &&
          span.version === citation.version &&
          span.name === citation.sourceName
      );
      starts = [...new Set(spans.flatMap((span) => occurrences(span.text, quote, span.start)))];
      if (starts.length !== 1)
        invalid(
          'Campaign quote must occur exactly once within supplied frozen source spans; use a longer exact quote if ambiguous.'
        );
      citation.start = starts[0]!;
      citation.end = starts[0]! + quote.length;
    }
  };
  const bound = mapResponseCitations(response, (citation, book, path) => {
    try {
      bind(citation, book, path);
    } catch (error) {
      if (!(error instanceof ResponseFieldProblem)) throw error;
      problems.push(error);
    }
  }) as T;
  if (problems.length === 1) throw problems[0];
  if (problems.length > 1) throw new ResponseFieldProblems(problems);
  return bound;
}
