import { RuleStore, ruleContent, ruleContext } from './ruleStore.js';
import { RulePreview } from './rulePreview.js';
import { parseRuleBook, type ParsedRuleBook, type RuleUpload } from '../domain/ruleImport.js';
import { generateRuleMapping } from '../domain/ruleMapping.js';
import {
  RULE_COLUMNS,
  RULE_LIMITS,
  RuleSystemKind,
  type RuleContent,
  type RuleContext,
  type RuleSystem,
} from '../domain/rules.js';
import { Problem } from '../errors.js';
import { SHEET_LAYOUT_OPTIONS, type SheetLayout } from '../domain/sheetLayout.js';
import type { SheetLayoutState } from './ruleStore.js';
import { createHash, randomUUID } from 'node:crypto';
type BookPreview = { baseRevision: number; book: ParsedRuleBook };
export class RuleLibrary {
  constructor(
    readonly rules: RuleStore,
    readonly previews: RulePreview
  ) {}
  async preview(id: string, revision: number, files: RuleUpload[]) {
    const current = await this.rules.get(id);
    if (current.kind !== RuleSystemKind.Library)
      throw new Problem(422, 'rules_default_protected', 'Default accepts instructions only');
    let book: ParsedRuleBook;
    try {
      book = parseRuleBook(files);
    } catch (error) {
      throw new Problem(
        422,
        'rules_import_invalid',
        error instanceof Error ? error.message : 'Invalid rule package'
      );
    }
    const next = this.replace(current, book);
    const staged = await this.previews.stage(id, {
      baseRevision: revision,
      book,
    } satisfies BookPreview);
    return {
      previewId: staged.id,
      expiresAt: staged.expiresAt,
      source: book.manifest.source,
      nodeCount: book.nodeCount,
      coverage: book.manifest.coverage,
      replacing: current.sources.some((source) => source.slug === book.manifest.source.slug),
      columns: RULE_COLUMNS.filter((column) => Object.keys(next[column]).length),
      warnings:
        book.manifest.source.pdfHash === null
          ? ['Original PDF hash is unknown; uploaded column hashes were verified.']
          : ['Original PDF is unavailable; its declared hash was not independently verified.'],
    };
  }
  private replace(current: RuleSystem, book: ParsedRuleBook): RuleContent {
    const next = structuredClone(ruleContent(current));
    const slug = book.manifest.source.slug;
    next.sources = [
      ...current.sources.filter((source) => source.slug !== slug),
      book.manifest.source,
    ].sort((a, b) => a.slug.localeCompare(b.slug));
    for (const column of RULE_COLUMNS) {
      delete next[column][slug];
      if (Object.hasOwn(book.columns[column], slug))
        next[column][slug] = book.columns[column][slug]!;
    }
    next.mapping = generateRuleMapping(next).mapping;
    return next;
  }
  async confirm(
    id: string,
    input: { revision: number; requestId: string; previewId: string }
  ): Promise<RuleContext> {
    let preview: BookPreview | null = null;
    try {
      preview = await this.previews.get<BookPreview>(input.previewId, id);
    } catch (error) {
      if (!(error instanceof Problem && error.code === 'rules_preview_missing')) throw error;
    }
    const identity = {
      revision: input.revision,
      requestId: input.requestId,
      previewId: input.previewId,
    };
    const result = await this.rules.store.transaction(async (client) => {
      const current = await this.rules.get(id, client, 'update');
      const replay = await this.rules.confirmation(id, input.requestId, identity, client);
      if (replay) return replay;
      if (!preview)
        throw new Problem(404, 'rules_preview_missing', 'Preview expired or was consumed');
      const published = await this.rules.write(
        current,
        this.replace(current, preview.book),
        client
      );
      await this.rules.saveConfirmation(
        id,
        input.requestId,
        identity,
        preview.book.inputHash,
        published,
        client
      );
      return published;
    });
    await this.previews.cancel(input.previewId);
    return result;
  }
  async instructions(
    id: string,
    revision: number,
    instructions: string,
    requestId: string = randomUUID()
  ): Promise<RuleContext> {
    const inputHash = createHash('sha256').update(instructions).digest('hex');
    const identity = { revision, requestId, inputHash, operation: 'instructions' };
    return this.rules.store.transaction(async (client) => {
      const current = await this.rules.get(id, client, 'update');
      const replay = await this.rules.confirmation(id, requestId, identity, client);
      if (replay) return replay;
      const result = await this.rules.write(
        current,
        { ...ruleContent(current), instructions },
        client
      );
      await this.rules.saveConfirmation(id, requestId, identity, inputHash, result, client);
      return result;
    });
  }
  async sheetLayout(id: string, requestId: string, layout: SheetLayout): Promise<SheetLayoutState> {
    const inputHash = createHash('sha256').update(JSON.stringify(layout)).digest('hex');
    const identity = { operation: 'sheetLayout', requestId, inputHash };
    return this.rules.store.transaction(async (client) => {
      await this.rules.get(id, client, 'update');
      const replay = await this.rules.confirmation<SheetLayoutState>(
        id,
        requestId,
        identity,
        client
      );
      if (replay) return replay;
      const saved = await this.rules.setSheetLayout(id, layout, client);
      await this.rules.saveConfirmation(id, requestId, identity, inputHash, saved, client);
      return saved;
    });
  }
  async metadata(id: string) {
    const current = await this.rules.get(id);
    const layout = await this.rules.sheetLayout(id);
    return {
      ...layout,
      sheetLayoutOptions: SHEET_LAYOUT_OPTIONS,
      ...ruleContext(current),
      instructions: current.instructions,
      sources: current.sources,
      populatedColumns: RULE_COLUMNS.filter((column) => Object.keys(current[column]).length),
      booksAllowed: current.kind === RuleSystemKind.Library,
      limits: RULE_LIMITS,
    };
  }
}
