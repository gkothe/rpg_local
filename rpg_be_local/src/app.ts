import { NPC_CONTINUITY_LIMITS } from './domain/continuity.js';
import { NPC_PREPARATION_LIMITS } from './domain/npcPreparation.js';
import { publicCampaign, publicTurn } from './domain/playerProjection.js';
import { operationalProblem } from './processingErrors.js';
import {
  KNOWLEDGE_KIND_OPTIONS,
  KNOWLEDGE_ORIGIN_OPTIONS,
  KNOWLEDGE_CERTAINTY_OPTIONS,
  KNOWLEDGE_STATUS_OPTIONS,
} from './domain/options.js';
import { CampaignService } from './services/campaigns.js';
import { SourceLibrary } from './services/sourceLibrary.js';
import express, { type Request, type RequestHandler, type ErrorRequestHandler } from 'express';
import multer from 'multer';
import path from 'node:path';
import { z } from 'zod';
import { Store } from './store.js';
import { ProviderService } from './providers/service.js';
import { TurnService } from './services/turns.js';
import { LibraryService } from './services/library.js';
import { JournalService } from './services/journal.js';
import { AdvancementService } from './services/advancement.js';
import {
  ADVANCEMENT_OPTIONS,
  AdvancementAction,
  advancementRequestSchema,
  advancementApplySchema,
  advancementAdjustSchema,
} from './domain/advancement.js';
import { MemoryRebuildService } from './services/memoryRebuild.js';
import { HistoryRecallService } from './services/historyProtection.js';
import {
  historyDetailQuerySchema,
  historyDisableSchema,
  historyListQuerySchema,
  historyProtectionSchema,
} from './domain/historyRecall.js';
import {
  MEMORY_REBUILD_ACTION_OPTIONS,
  MEMORY_REBUILD_LIMITS,
  MEMORY_REBUILD_STATUS_OPTIONS,
  memoryRebuildApplySchema,
  memoryRebuildListQuerySchema,
  memoryRebuildRequestSchema,
  memoryRebuildStartSchema,
  MEMORY_REBUILD_PURPOSE_OPTIONS,
} from './domain/memoryRebuild.js';
import {
  JOURNAL_CHECK_OUTCOME_OPTIONS,
  JOURNAL_GROUP_OPTIONS,
  JOURNAL_JOB_KIND_OPTIONS,
  JOURNAL_JOB_STATUS_OPTIONS,
  JOURNAL_LIMITS,
  JournalJobKind,
  journalAcceptRequestSchema,
  journalCheckRequestSchema,
  journalListQuerySchema,
  journalRequestSchema,
} from './domain/journal.js';
import {
  audioDiagnostics,
  extractFile,
  extractGoogle,
  textSource,
  transcribe,
} from './services/sources.js';
import { Problem } from './errors.js';
import { sheetLayoutRequestSchema } from './domain/sheetLayout.js';
import { appRoot, uploadBytes } from './config.js';
import {
  campaignCreateSchema,
  campaignPatchSchema,
  characterInput,
  idSchema,
  turnInputSchema,
  ocrLanguageSchema,
  transcriptionLanguageSchema,
  campaignRuleBindingSchema,
} from './domain/schemas.js';
import { accessBoundary, LanAccess } from './security.js';
import {
  MAX_ENTITY_NAME_CHARS,
  MAX_LONG_TEXT_CHARS,
  MAX_SOURCE_TEXT_CHARS,
} from './domain/limits.js';
import {
  COMBAT_FIELD_KIND_OPTIONS,
  COMBAT_LIMITS,
  COMBAT_ROLL_KIND_OPTIONS,
  COMBAT_ROLL_SCOPE_OPTIONS,
} from './domain/combat.js';
import { DICE_LIMITS } from './domain/dice.js';
import { RULE_COLUMNS, RULE_LIMITS, ruleSlugSchema } from './domain/rules.js';
import { RuleStore } from './services/ruleStore.js';
import { RuleLibrary } from './services/ruleLibrary.js';
import { RulePreview } from './services/rulePreview.js';
import { RuleLookup } from './services/ruleLookup.js';
import { RuleBackup } from './services/ruleBackup.js';
import { ruleUploadStorage } from './services/ruleUpload.js';
import {
  TURN_STATUS_OPTIONS,
  CHARACTER_TYPE_OPTIONS,
  SOURCE_KIND_OPTIONS,
  SOURCE_STATUS_OPTIONS,
  OCR_LANGUAGE_OPTIONS,
  TRANSCRIPTION_LANGUAGE_OPTIONS,
  CONTEXT_DEFAULTS,
  CharacterType,
  OCR_LANGUAGE_CODES,
  SourcePurpose,
  SOURCE_PURPOSE_OPTIONS,
} from './domain/options.js';
const revisionSchema = z.object({ revision: z.number().int().nonnegative() }).strict();
const page = (req: Request) => ({
  limit: z.coerce.number().int().min(1).max(100).default(20).parse(req.query.limit),
  offset: z.coerce.number().int().min(0).max(100000).default(0).parse(req.query.cursor),
});
const wrap =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
const param = (req: Request, key: string) => idSchema.parse(req.params[key]);
export type AppOptions = {
  rulePreviews?: RulePreview;
  store: Store | null;
  providers?: ProviderService;
  allowedHosts?: string[];
  allowedOrigins?: string[];
  lan?: boolean;
  frontendDir?: string;
  connectUrls?: string[];
};
export function createApp(options: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  const store = options.store;
  const providers = options.providers ?? new ProviderService();
  const turns = store ? new TurnService(store, providers) : null;
  const library = store ? new LibraryService(store) : null;
  const campaigns = store ? new CampaignService(store, providers) : null;
  const journal = store ? new JournalService(store, providers) : null;
  const advancement = store ? new AdvancementService(store, providers) : null;
  const memoryRebuild = store ? new MemoryRebuildService(store, providers) : null;
  const historyRecall = store ? new HistoryRecallService(store) : null;
  const sources = store ? new SourceLibrary(store) : null;
  const rules = store ? new RuleStore(store) : null;
  const ruleLookup = new RuleLookup();
  let ruleLibrary: RuleLibrary | null = null;
  const getRuleLibrary = () => {
    if (!rules) throw new Problem(503, 'database_setup', 'Configure local PostgreSQL first');
    ruleLibrary ??= new RuleLibrary(rules, options.rulePreviews ?? new RulePreview());
    return ruleLibrary;
  };
  const ruleUpload = multer({
    storage: ruleUploadStorage(),
    limits: {
      files: RULE_LIMITS.importFiles,
      fileSize: RULE_LIMITS.importFileBytes,
      fields: 1,
      fieldSize: RULE_LIMITS.requestBytes,
    },
  });
  const backupUpload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 1, fileSize: RULE_LIMITS.backupBytes, fields: 0 },
  });
  const lan = new LanAccess(options.lan ?? false);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: uploadBytes, files: 1, fields: 4 },
  });
  app.use(
    accessBoundary(
      options.allowedHosts ?? [
        '127.0.0.1:4100',
        'localhost:4100',
        '127.0.0.1:5174',
        'localhost:5174',
      ],
      options.allowedOrigins ?? [
        'http://127.0.0.1:4100',
        'http://localhost:4100',
        'http://127.0.0.1:5174',
        'http://localhost:5174',
      ]
    )
  );
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.use(express.json({ limit: '20mb' }));
  app.use('/api', lan.middleware());
  app.get(
    '/api/health',
    wrap(async (_req, res) => {
      let database = false;
      try {
        await store?.pool.query('SELECT 1');
        database = !!store;
      } catch {
        // Keep degraded status when PostgreSQL is unavailable.
      }
      res
        .status(database ? 200 : 503)
        .json({ data: { status: database ? 'ok' : 'degraded', database } });
    })
  );
  app.get(
    '/api/settings',
    wrap(async (_req, res) => {
      res.json({
        data: {
          turnStatuses: TURN_STATUS_OPTIONS.map((x) => x.id),
          sourceKinds: SOURCE_KIND_OPTIONS.map((x) => x.id),
          characterTypes: CHARACTER_TYPE_OPTIONS.map((x) => x.id),
          turnStatusOptions: TURN_STATUS_OPTIONS,
          characterTypeOptions: CHARACTER_TYPE_OPTIONS,
          sourceKindOptions: SOURCE_KIND_OPTIONS,
          sourcePurposeOptions: SOURCE_PURPOSE_OPTIONS,
          knowledgeKindOptions: KNOWLEDGE_KIND_OPTIONS,
          knowledgeOriginOptions: KNOWLEDGE_ORIGIN_OPTIONS,
          knowledgeCertaintyOptions: KNOWLEDGE_CERTAINTY_OPTIONS,
          knowledgeStatusOptions: KNOWLEDGE_STATUS_OPTIONS,
          advancement: ADVANCEMENT_OPTIONS,
          journal: {
            groupOptions: JOURNAL_GROUP_OPTIONS,
            jobKindOptions: JOURNAL_JOB_KIND_OPTIONS,
            jobStatusOptions: JOURNAL_JOB_STATUS_OPTIONS,
            checkOutcomeOptions: JOURNAL_CHECK_OUTCOME_OPTIONS,
            limits: JOURNAL_LIMITS,
          },
          history: historyRecall?.options() ?? null,
          memoryRebuild: {
            statusOptions: MEMORY_REBUILD_STATUS_OPTIONS,
            actionOptions: MEMORY_REBUILD_ACTION_OPTIONS,
            purposeOptions: MEMORY_REBUILD_PURPOSE_OPTIONS,
            limits: MEMORY_REBUILD_LIMITS,
          },
          sourceStatusOptions: SOURCE_STATUS_OPTIONS,
          ocrLanguageOptions: OCR_LANGUAGE_OPTIONS,
          transcriptionLanguageOptions: TRANSCRIPTION_LANGUAGE_OPTIONS,
          defaults: {
            characterType: CharacterType.Player,
            ocrLanguage: OCR_LANGUAGE_OPTIONS[0].id,
            transcriptionLanguage: TRANSCRIPTION_LANGUAGE_OPTIONS[0].id,
            budgets: CONTEXT_DEFAULTS,
          },
          audio: await audioDiagnostics(),
          lan: { enabled: options.lan ?? false },
          limits: { uploadBytes },
          dice: { enabled: true, limits: DICE_LIMITS },
          rules: { columns: RULE_COLUMNS, limits: RULE_LIMITS },
          npc: {
            continuity: true,
            profileLimits: NPC_CONTINUITY_LIMITS,
            preparation: {
              enabled: true,
              limits: NPC_PREPARATION_LIMITS,
            },
          },
          combat: {
            fieldKindOptions: COMBAT_FIELD_KIND_OPTIONS,
            rollScopeOptions: COMBAT_ROLL_SCOPE_OPTIONS,
            rollKindOptions: COMBAT_ROLL_KIND_OPTIONS,
            limits: COMBAT_LIMITS,
          },
        },
      });
    })
  );
  app.get(
    '/api/providers',
    wrap(async (req, res) => {
      res.json({ data: await providers.list(req.query.refresh === 'true') });
    })
  );
  app.post('/api/lan/code', (req, res, next) => {
    try {
      res.json({ data: lan.codeForDesktop(req) });
    } catch (e) {
      next(e);
    }
  });
  app.get('/api/lan/status', (req, res) => {
    res.json({ data: lan.status(req, options.connectUrls ?? []) });
  });
  app.post('/api/lan/pair', (req, res, next) => {
    try {
      const { code } = z
        .object({ code: z.string().max(20) })
        .strict()
        .parse(req.body);
      const token = lan.pair(req, code);
      res.cookie('rpg-device', token, {
        httpOnly: true,
        secure: req.secure,
        sameSite: 'strict',
        maxAge: 12 * 60 * 60 * 1000,
        path: '/api',
      });
      res.json({ data: { paired: true } });
    } catch (e) {
      next(e);
    }
  });
  app.post('/api/lan/revoke', (req, res, next) => {
    try {
      lan.revoke(req);
      res.json({ data: { revoked: true } });
    } catch (e) {
      next(e);
    }
  });
  app.post(
    '/api/audio/transcriptions',
    upload.single('file'),
    wrap(async (req, res) => {
      if (!req.file) throw new Problem(422, 'upload_required', 'Choose an audio recording');
      const language = transcriptionLanguageSchema
        .default(TRANSCRIPTION_LANGUAGE_OPTIONS[0].id)
        .parse(req.body.language);
      res.json({ data: await transcribe(req.file.buffer, language) });
    })
  );
  const requireDb: RequestHandler = (_req, _res, next) => {
    if (!store)
      next(
        new Problem(
          503,
          'database_setup',
          'Configure RPG_DATABASE_URL and run PostgreSQL migrations before creating a game'
        )
      );
    else next();
  };
  app.use('/api/campaigns', requireDb);
  app.use('/api/templates', requireDb);
  app.use('/api/character-templates', requireDb);
  app.use('/api/rule-systems', requireDb);
  app.post(
    '/api/rule-systems/backups/imports',
    backupUpload.single('file'),
    wrap(async (req, res) => {
      if (!req.file)
        throw new Problem(422, 'upload_required', 'Choose a private rule-library backup');
      const service = getRuleLibrary();
      res.status(201).json({
        data: await new RuleBackup(service.rules, service.previews).preview(req.file.buffer),
      });
    })
  );
  app.post(
    '/api/rule-systems/backups/imports/:previewId/confirm',
    wrap(async (req, res) => {
      const input = z
        .object({
          systemId: z.uuid(),
          systemKey: ruleSlugSchema,
          revision: z.number().int().positive().nullable(),
          requestId: z.uuid(),
          replace: z.boolean(),
        })
        .strict()
        .parse(req.body);
      const service = getRuleLibrary();
      res.json({
        data: await new RuleBackup(service.rules, service.previews).confirm({
          ...input,
          previewId: param(req, 'previewId'),
        }),
      });
    })
  );
  app.get(
    '/api/rule-systems/:id/backups',
    wrap(async (req, res) => {
      const service = getRuleLibrary();
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="private-rules-${param(req, 'id')}.json"`
      );
      res.json({
        data: await new RuleBackup(service.rules, service.previews).export(param(req, 'id')),
      });
    })
  );
  app.get(
    '/api/campaigns/:id/rule-system/resolution',
    wrap(async (req, res) => {
      const campaign = await store!.campaign(param(req, 'id'));
      if (!campaign.ruleResolution)
        throw new Problem(
          409,
          'rules_reference_resolved',
          'This campaign has no unresolved rule reference'
        );
      const reference = campaign.ruleResolution.reference;
      const candidate = await store!.pool.query(
        'SELECT id FROM rule_systems WHERE system_key=$1 AND kind=$2',
        [reference.systemKey, reference.kind]
      );
      const current = candidate.rows[0]
        ? await getRuleLibrary().metadata(candidate.rows[0].id)
        : null;
      res.json({
        data: {
          reference,
          candidate: current,
          hashChanged: current ? current.contentHash !== reference.contentHash : null,
        },
      });
    })
  );
  app.post(
    '/api/campaigns/:id/rule-system/resolution',
    wrap(async (req, res) => {
      res.json({
        data: await campaigns!.bindRules(
          param(req, 'id'),
          campaignRuleBindingSchema.parse(req.body),
          true
        ),
      });
    })
  );
  app.get(
    '/api/campaigns/:id/turns/:turnId/rule-reads',
    wrap(async (req, res) => {
      const offset = z.coerce
        .number()
        .int()
        .min(0)
        .max(RULE_LIMITS.calls)
        .default(0)
        .parse(req.query.cursor);
      res.json(await rules!.history(param(req, 'id'), param(req, 'turnId'), offset));
    })
  );
  app.patch(
    '/api/campaigns/:id/rule-system',
    wrap(async (req, res) => {
      res.json({
        data: await campaigns!.bindRules(
          param(req, 'id'),
          campaignRuleBindingSchema.parse(req.body)
        ),
      });
    })
  );
  app.get(
    '/api/campaigns/:id/rule-system',
    wrap(async (req, res) => {
      const campaign = await store!.campaign(param(req, 'id'));
      if (campaign.ruleResolution) {
        res.json({ data: { unresolved: campaign.ruleResolution } });
        return;
      }
      res.json({
        data: await getRuleLibrary().metadata((await rules!.resolve(campaign)).systemId),
      });
    })
  );
  app.get(
    '/api/rule-systems',
    wrap(async (req, res) => {
      const { limit, offset } = page(req);
      const items = await rules!.list(limit + 1, offset);
      res.json({
        data: items.slice(0, limit),
        pagination: { nextCursor: items.length > limit ? String(offset + limit) : null },
      });
    })
  );
  app.post(
    '/api/rule-systems',
    wrap(async (req, res) => {
      const input = z
        .object({ systemKey: ruleSlugSchema, name: z.string().min(1).max(RULE_LIMITS.nameChars) })
        .strict()
        .parse(req.body);
      res.status(201).json({ data: await rules!.create(input.systemKey, input.name) });
    })
  );
  app.get(
    '/api/rule-systems/:id',
    wrap(async (req, res) => {
      res.json({ data: await getRuleLibrary().metadata(param(req, 'id')) });
    })
  );
  app.patch(
    '/api/rule-systems/:id/instructions',
    wrap(async (req, res) => {
      const input = z
        .object({
          revision: z.number().int().positive(),
          requestId: z.uuid(),
          instructions: z
            .string()
            .refine((value) => Buffer.byteLength(value) <= RULE_LIMITS.instructionsBytes),
        })
        .strict()
        .parse(req.body);
      res.json({
        data: await getRuleLibrary().instructions(
          param(req, 'id'),
          input.revision,
          input.instructions,
          input.requestId
        ),
      });
    })
  );
  app.put(
    '/api/rule-systems/:id/sheet-layout',
    wrap(async (req, res) => {
      const parsed = sheetLayoutRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        const layoutIssues = parsed.error.issues.filter((issue) => issue.path[0] === 'sheetLayout');
        if (layoutIssues.length)
          throw new Problem(
            422,
            'sheet_layout_invalid',
            'Invalid sheet layout: ' +
              layoutIssues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
          );
        throw parsed.error;
      }
      res.json({
        data: await getRuleLibrary().sheetLayout(
          param(req, 'id'),
          parsed.data.requestId,
          parsed.data.sheetLayout
        ),
      });
    })
  );
  app.post(
    '/api/rule-systems/:id/imports',
    ruleUpload.array('files', RULE_LIMITS.importFiles),
    wrap(async (req, res) => {
      const input = z
        .object({ revision: z.coerce.number().int().positive() })
        .strict()
        .parse(req.body);
      const files = req.files as Express.Multer.File[];
      if (!files?.length)
        throw new Problem(422, 'rules_files_missing', 'Upload manifest.json and its column files');
      res.status(201).json({
        data: await getRuleLibrary().preview(
          param(req, 'id'),
          input.revision,
          files.map((file) => ({ name: file.originalname, bytes: file.buffer }))
        ),
      });
    })
  );
  app.post(
    '/api/rule-systems/:id/imports/:previewId/confirm',
    wrap(async (req, res) => {
      const input = z
        .object({ revision: z.number().int().positive(), requestId: z.uuid() })
        .strict()
        .parse(req.body);
      res.json({
        data: await getRuleLibrary().confirm(param(req, 'id'), {
          ...input,
          previewId: param(req, 'previewId'),
        }),
      });
    })
  );
  for (const [route, tool] of [
    ['search', 'rules_search'],
    ['nodes', 'rules_get'],
    ['mapping', 'rules_map'],
  ] as const) {
    app.get(
      `/api/rule-systems/:id/${route}`,
      wrap(async (req, res) => {
        const system = await rules!.get(param(req, 'id'));
        const raw: Record<string, unknown> = { ...req.query };
        const selectedTool = tool === 'rules_get' && raw.view === 'children' ? 'rules_list' : tool;
        if (selectedTool === 'rules_list') delete raw.view;
        if (typeof raw.columns === 'string') raw.columns = raw.columns.split(',');
        res.json({ data: ruleLookup.execute(system, selectedTool, raw, 'browser') });
      })
    );
  }
  app.get(
    '/api/campaigns',
    wrap(async (req, res) => {
      const { limit, offset } = page(req);
      const items = (await store!.list(limit + 1, offset)).map(publicCampaign);
      res.json({
        data: items.slice(0, limit),
        pagination: { nextCursor: items.length > limit ? String(offset + limit) : null },
      });
    })
  );
  app.post(
    '/api/campaigns',
    wrap(async (req, res) => {
      const input = campaignCreateSchema.parse(req.body);
      const c = await campaigns!.create(input);
      res.status(201).json({ data: publicCampaign(c) });
    })
  );
  app.post(
    '/api/campaigns/import',
    wrap(async (req, res) => {
      const { archive } = z.object({ archive: z.unknown() }).strict().parse(req.body);
      const c = await library!.import(archive);
      res.status(201).json({
        data: { ...publicCampaign(c), turns: (await store!.turns(c.id)).map(publicTurn) },
      });
    })
  );
  app.get(
    '/api/campaigns/:id',
    wrap(async (req, res) => {
      const id = param(req, 'id');
      const c = await store!.campaign(id);
      res.json({
        data: { ...publicCampaign(c), turns: (await store!.recentTurns(id)).map(publicTurn) },
      });
    })
  );
  app.patch(
    '/api/campaigns/:id',
    wrap(async (req, res) => {
      const { revision, ...patch } = campaignPatchSchema.parse(req.body);
      const c = await campaigns!.patch(param(req, 'id'), revision, patch);
      res.json({ data: publicCampaign(c) });
    })
  );
  app.delete(
    '/api/campaigns/:id',
    wrap(async (req, res) => {
      const { revision } = revisionSchema.parse(req.body);
      const id = param(req, 'id');
      await campaigns!.delete(id, revision);
      res.json({ data: { deleted: true } });
    })
  );
  app.patch(
    '/api/campaigns/:id/notes',
    wrap(async (req, res) => {
      const input = z
        .object({
          notes: z.string().max(MAX_LONG_TEXT_CHARS),
          notesRevision: z.number().int().nonnegative(),
        })
        .strict()
        .parse(req.body);
      const c = await campaigns!.notes(param(req, 'id'), input);
      res.json({ data: publicCampaign(c) });
    })
  );
  app.post(
    '/api/campaigns/:id/characters',
    wrap(async (req, res) => {
      const { revision, ...input } = characterInput
        .extend({ revision: z.number().int().nonnegative() })
        .parse(req.body);
      const c = await campaigns!.addCharacter(param(req, 'id'), revision, input);
      res.status(201).json({ data: publicCampaign(c) });
    })
  );
  app.patch(
    '/api/campaigns/:id/characters/:characterId',
    wrap(async (req, res) => {
      const { revision, ...patch } = characterInput
        .omit({ type: true })
        .partial()
        .extend({ revision: z.number().int().nonnegative() })
        .strict()
        .parse(req.body);
      const characterId = param(req, 'characterId');
      const c = await campaigns!.patchCharacter(param(req, 'id'), characterId, revision, patch);
      res.json({ data: publicCampaign(c) });
    })
  );
  app.delete(
    '/api/campaigns/:id/characters/:characterId',
    wrap(async (req, res) => {
      const { revision } = revisionSchema.parse(req.body);
      const characterId = param(req, 'characterId');
      const c = await campaigns!.deleteCharacter(param(req, 'id'), characterId, revision);
      res.json({ data: publicCampaign(c) });
    })
  );
  app.post(
    '/api/campaigns/:id/sources',
    wrap(async (req, res) => {
      const { revision, name, text, purpose } = z
        .object({
          revision: z.number().int().nonnegative(),
          name: z.string().min(1).max(MAX_ENTITY_NAME_CHARS),
          text: z.string().max(MAX_SOURCE_TEXT_CHARS),
          purpose: z.enum(SourcePurpose).optional(),
        })
        .strict()
        .parse(req.body);
      const c = await sources!.add(
        param(req, 'id'),
        revision,
        textSource(name, text, undefined, purpose)
      );
      res.status(201).json({ data: publicCampaign(c) });
    })
  );
  app.post(
    '/api/campaigns/:id/sources/extract',
    upload.single('file'),
    wrap(async (req, res) => {
      const id = param(req, 'id');
      const revision = z.coerce.number().int().nonnegative().parse(req.body.revision);
      const language = ocrLanguageSchema.default(OCR_LANGUAGE_CODES[0]).parse(req.body.language);
      const purpose = z.enum(SourcePurpose).optional().parse(req.body.purpose);
      const source = req.file
        ? await extractFile(req.file.buffer, req.file.originalname, language, purpose)
        : await extractGoogle(
            z.string().max(2000).parse(req.body.url),
            z.string().max(MAX_ENTITY_NAME_CHARS).optional().parse(req.body.name),
            purpose
          );
      const c = await sources!.add(id, revision, source, req.file?.buffer);
      res.status(201).json({ data: publicCampaign(c) });
    })
  );
  app.patch(
    '/api/campaigns/:id/sources/:sourceId',
    wrap(async (req, res) => {
      const input = z
        .object({
          revision: z.number().int().nonnegative(),
          text: z.string().min(1).max(MAX_SOURCE_TEXT_CHARS),
          name: z.string().min(1).max(MAX_ENTITY_NAME_CHARS).optional(),
          confirmed: z.boolean(),
          purpose: z.enum(SourcePurpose).optional(),
        })
        .strict()
        .parse(req.body);
      const sourceId = param(req, 'sourceId');
      const c = await sources!.correct(param(req, 'id'), sourceId, input);
      res.json({ data: publicCampaign(c) });
    })
  );
  app.delete(
    '/api/campaigns/:id/sources/:sourceId',
    wrap(async (req, res) => {
      const { revision } = revisionSchema.parse(req.body);
      const sourceId = param(req, 'sourceId');
      const c = await sources!.delete(param(req, 'id'), sourceId, revision);
      res.json({ data: publicCampaign(c) });
    })
  );
  app.get(
    '/api/campaigns/:id/sources/:sourceId/sections',
    wrap(async (req, res) => {
      res.json({ data: await sources!.sections(param(req, 'id'), param(req, 'sourceId')) });
    })
  );
  app.get(
    '/api/campaigns/:id/sources/:sourceId/original',
    wrap(async (req, res) => {
      const original = await sources!.original(param(req, 'id'), param(req, 'sourceId'));
      res.setHeader('Content-Type', original.content_type);
      res.setHeader('Content-Disposition', 'inline');
      res.send(original.bytes);
    })
  );
  app.post(
    '/api/campaigns/:id/character-drafts',
    wrap(async (req, res) => {
      const input = z
        .object({ revision: z.number().int().nonnegative(), sourceId: idSchema })
        .strict()
        .parse(req.body);
      res.json({ data: await sources!.characterDraft(param(req, 'id'), input, providers) });
    })
  );
  app.get(
    '/api/campaigns/:id/turns',
    wrap(async (req, res) => {
      const id = param(req, 'id');
      await store!.campaign(id);
      const { limit, offset } = page(req);
      const items = (await store!.turns(id, undefined, limit + 1, offset)).map(publicTurn);
      res.json({
        data: items.slice(0, limit),
        pagination: { nextCursor: items.length > limit ? String(offset + limit) : null },
      });
    })
  );
  app.post(
    '/api/campaigns/:id/turns',
    wrap(async (req, res) => {
      res.status(202).json({
        data: publicTurn(await turns!.submit(param(req, 'id'), turnInputSchema.parse(req.body))),
      });
    })
  );
  app.get(
    '/api/campaigns/:id/turns/:turnId/context',
    wrap(async (req, res) => {
      res.json({ data: await store!.turnContext(param(req, 'id'), param(req, 'turnId')) });
    })
  );
  app.get(
    '/api/campaigns/:id/advancement/summary',
    wrap(async (req, res) => {
      res.json({ data: await advancement!.summary(param(req, 'id')) });
    })
  );
  app.get(
    '/api/campaigns/:id/advancement/reviews',
    wrap(async (req, res) => {
      const { limit, offset } = page(req);
      res.json({ data: await advancement!.list(param(req, 'id'), limit, offset) });
    })
  );
  app.post(
    '/api/campaigns/:id/advancement/reviews',
    wrap(async (req, res) => {
      const { requestId } = advancementRequestSchema.parse(req.body);
      res.status(202).json({ data: await advancement!.start(param(req, 'id'), requestId) });
    })
  );
  app.get(
    '/api/campaigns/:id/advancement/reviews/:reviewId',
    wrap(async (req, res) => {
      res.json({ data: await advancement!.status(param(req, 'id'), param(req, 'reviewId')) });
    })
  );
  for (const action of Object.values(AdvancementAction))
    app.post(
      `/api/campaigns/:id/advancement/reviews/:reviewId/${action}`,
      wrap(async (req, res) => {
        const body = (
          action === AdvancementAction.Adjust
            ? advancementAdjustSchema
            : action === AdvancementAction.Apply
              ? advancementApplySchema
              : advancementRequestSchema
        ).parse(req.body);
        res.json({
          data: await advancement!.decide(param(req, 'id'), param(req, 'reviewId'), action, body),
        });
      })
    );
  app.get(
    '/api/campaigns/:id/journal/entries',
    wrap(async (req, res) => {
      const query = journalListQuerySchema.parse(req.query);
      res.json({ data: await journal!.list(param(req, 'id'), query) });
    })
  );
  app.get(
    '/api/campaigns/:id/journal/entries/:entryId',
    wrap(async (req, res) => {
      res.json({ data: await journal!.entry(param(req, 'id'), param(req, 'entryId')) });
    })
  );
  app.get(
    '/api/campaigns/:id/journal/entries/:entryId/evidence/:evidenceId',
    wrap(async (req, res) => {
      const evidenceId = z
        .string()
        .regex(/^(turn-[0-9a-f-]{36}|evidence-\d{1,6})$/)
        .parse(req.params.evidenceId);
      res.json({
        data: await journal!.evidence(param(req, 'id'), param(req, 'entryId'), evidenceId),
      });
    })
  );
  app.post(
    '/api/campaigns/:id/journal/backfills',
    wrap(async (req, res) => {
      const { requestId } = journalRequestSchema.parse(req.body);
      const job = await journal!.start(param(req, 'id'), JournalJobKind.Backfill, requestId);
      res.status(202).json({ data: { jobId: job.id, ...job } });
    })
  );
  app.post(
    '/api/campaigns/:id/journal/entries/:entryId/checks',
    wrap(async (req, res) => {
      const { requestId, explanation } = journalCheckRequestSchema.parse(req.body);
      const job = await journal!.start(param(req, 'id'), JournalJobKind.Check, requestId, {
        entryId: param(req, 'entryId'),
        explanation,
      });
      res.status(202).json({ data: { jobId: job.id, ...job } });
    })
  );
  app.get(
    '/api/campaigns/:id/journal/jobs/:jobId',
    wrap(async (req, res) => {
      res.json({ data: await journal!.status(param(req, 'id'), param(req, 'jobId')) });
    })
  );
  app.post(
    '/api/campaigns/:id/journal/jobs/:jobId/cancel',
    wrap(async (req, res) => {
      journalRequestSchema.parse(req.body);
      res.json({ data: await journal!.cancel(param(req, 'id'), param(req, 'jobId')) });
    })
  );
  app.post(
    '/api/campaigns/:id/journal/jobs/:jobId/retry',
    wrap(async (req, res) => {
      journalRequestSchema.parse(req.body);
      res.status(202).json({ data: await journal!.retry(param(req, 'id'), param(req, 'jobId')) });
    })
  );
  app.post(
    '/api/campaigns/:id/journal/jobs/:jobId/accept',
    wrap(async (req, res) => {
      const { requestId, proposalDigest } = journalAcceptRequestSchema.parse(req.body);
      res.json({
        data: await journal!.accept(
          param(req, 'id'),
          param(req, 'jobId'),
          requestId,
          proposalDigest
        ),
      });
    })
  );
  app.post(
    '/api/campaigns/:id/journal/jobs/:jobId/dismiss',
    wrap(async (req, res) => {
      const { requestId } = journalRequestSchema.parse(req.body);
      res.json({ data: await journal!.dismiss(param(req, 'id'), param(req, 'jobId'), requestId) });
    })
  );
  app.get(
    '/api/campaigns/:id/turns/:turnId',
    wrap(async (req, res) => {
      res.json({ data: publicTurn(await store!.turn(param(req, 'id'), param(req, 'turnId'))) });
    })
  );
  app.post(
    '/api/campaigns/:id/turns/:turnId/retry',
    wrap(async (req, res) => {
      const input = turnInputSchema.omit({ action: true }).parse(req.body);
      res.status(202).json({
        data: publicTurn(await turns!.retry(param(req, 'id'), param(req, 'turnId'), input)),
      });
    })
  );
  app.post(
    '/api/campaigns/:id/turns/:turnId/resume-editing',
    wrap(async (req, res) => {
      const input = z
        .object({ revision: z.number().int().nonnegative(), requestId: z.uuid() })
        .strict()
        .parse(req.body);
      res.status(202).json({
        data: publicTurn(await turns!.resumeEditing(param(req, 'id'), param(req, 'turnId'), input)),
      });
    })
  );
  app.post(
    '/api/campaigns/:id/turns/:turnId/cancel',
    wrap(async (req, res) => {
      z.object({}).strict().parse(req.body);
      res.json({ data: publicTurn(await turns!.cancel(param(req, 'id'), param(req, 'turnId'))) });
    })
  );
  app.get(
    '/api/campaigns/:id/turns/:turnId/events',
    wrap(async (req, res) => {
      const id = param(req, 'id');
      const turnId = param(req, 'turnId');
      await store!.turn(id, turnId);
      res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.flushHeaders();
      let running = false;
      const timer = setInterval(() => {
        if (running) return;
        running = true;
        void store!
          .turn(id, turnId)
          .then((t) => {
            res.write(`event: status\ndata: ${JSON.stringify(publicTurn(t))}\n\n`);
            if (TURN_STATUS_OPTIONS.find((x) => x.id === t.status)?.terminal) {
              clearInterval(timer);
              res.end();
            }
          })
          .catch(() => {
            clearInterval(timer);
            res.end();
          })
          .finally(() => {
            running = false;
          });
      }, 1000);
      req.on('close', () => clearInterval(timer));
    })
  );
  app.post(
    '/api/campaigns/:id/undo',
    wrap(async (req, res) => {
      const { revision } = revisionSchema.parse(req.body);
      const id = param(req, 'id');
      const c = await turns!.undo(id, revision);
      res.json({
        data: { ...publicCampaign(c), turns: (await store!.recentTurns(id)).map(publicTurn) },
      });
    })
  );
  app.post(
    '/api/campaigns/:id/memory',
    wrap(async (req, res) => {
      const input = z
        .object({
          revision: z.number().int().nonnegative(),
          text: z.string().trim().min(1),
          coveredTurnIds: z.array(idSchema),
          confirm: z.literal(true),
        })
        .strict()
        .parse(req.body);
      res.json({ data: publicCampaign(await turns!.manualMemory(param(req, 'id'), input)) });
    })
  );
  app.post(
    '/api/campaigns/:id/memory/rebuilds',
    wrap(async (req, res) => {
      const { requestId, purpose } = memoryRebuildStartSchema.parse(req.body);
      res
        .status(202)
        .json({ data: await memoryRebuild!.start(param(req, 'id'), requestId, purpose) });
    })
  );
  app.get(
    '/api/campaigns/:id/memory/rebuilds',
    wrap(async (req, res) => {
      const { limit, cursor } = memoryRebuildListQuerySchema.parse(req.query);
      res.json({ data: await memoryRebuild!.list(param(req, 'id'), limit, cursor) });
    })
  );
  app.get(
    '/api/campaigns/:id/memory/rebuilds/:jobId',
    wrap(async (req, res) => {
      res.json({ data: await memoryRebuild!.status(param(req, 'id'), param(req, 'jobId')) });
    })
  );
  app.post(
    '/api/campaigns/:id/memory/rebuilds/:jobId/cancel',
    wrap(async (req, res) => {
      memoryRebuildRequestSchema.parse(req.body);
      res.json({ data: await memoryRebuild!.cancel(param(req, 'id'), param(req, 'jobId')) });
    })
  );
  app.post(
    '/api/campaigns/:id/memory/rebuilds/:jobId/resume',
    wrap(async (req, res) => {
      const { requestId } = memoryRebuildRequestSchema.parse(req.body);
      res.status(202).json({
        data: await memoryRebuild!.resume(param(req, 'id'), param(req, 'jobId'), requestId),
      });
    })
  );
  app.post(
    '/api/campaigns/:id/memory/rebuilds/:jobId/apply',
    wrap(async (req, res) => {
      const { requestId, proposalDigest, preserveMemory } = memoryRebuildApplySchema.parse(
        req.body
      );
      res.json({
        data: await memoryRebuild!.apply(
          param(req, 'id'),
          param(req, 'jobId'),
          requestId,
          proposalDigest,
          preserveMemory
        ),
      });
    })
  );
  app.post(
    '/api/campaigns/:id/memory/rebuilds/:jobId/discard',
    wrap(async (req, res) => {
      const { requestId } = memoryRebuildRequestSchema.parse(req.body);
      res.json({
        data: await memoryRebuild!.discard(param(req, 'id'), param(req, 'jobId'), requestId),
      });
    })
  );
  app.get(
    '/api/campaigns/:id/history',
    wrap(async (req, res) => {
      const query = historyListQuerySchema.parse(req.query);
      const id = param(req, 'id');
      const page = await historyRecall!.list(id, query);
      const status = await historyRecall!.status(id);
      res.json({ data: { ...page, status } });
    })
  );
  app.patch(
    '/api/campaigns/:id/history/settings',
    wrap(async (req, res) => {
      const input = historyDisableSchema.parse(req.body);
      res.json({ data: await historyRecall!.disable(param(req, 'id'), input) });
    })
  );
  app.patch(
    '/api/campaigns/:id/history/protection/knowledge/:targetId',
    wrap(async (req, res) => {
      const input = historyProtectionSchema.parse(req.body);
      res.json({
        data: await historyRecall!.protectKnowledge(
          param(req, 'id'),
          param(req, 'targetId'),
          input
        ),
      });
    })
  );
  app.patch(
    '/api/campaigns/:id/history/protection/sections/:targetId',
    wrap(async (req, res) => {
      const input = historyProtectionSchema.parse(req.body);
      res.json({
        data: await historyRecall!.protectSection(param(req, 'id'), param(req, 'targetId'), input),
      });
    })
  );
  app.patch(
    '/api/campaigns/:id/history/protection/memories/:targetId',
    wrap(async (req, res) => {
      const input = historyProtectionSchema.parse(req.body);
      res.json({
        data: await historyRecall!.protectMemory(param(req, 'id'), param(req, 'targetId'), input),
      });
    })
  );
  app.get(
    '/api/campaigns/:id/history/:fragmentId',
    wrap(async (req, res) => {
      const query = historyDetailQuerySchema.parse(req.query);
      res.json({
        data: await historyRecall!.detail(param(req, 'id'), param(req, 'fragmentId'), query),
      });
    })
  );
  app.get(
    '/api/campaigns/:id/export',
    wrap(async (req, res) => {
      res.json({ data: await library!.export(param(req, 'id')) });
    })
  );
  app.get(
    '/api/character-templates',
    wrap(async (req, res) => {
      const { limit, offset } = page(req);
      const items = await library!.listTemplates('character', limit + 1, offset);
      res.json({
        data: items.slice(0, limit),
        pagination: { nextCursor: items.length > limit ? String(offset + limit) : null },
      });
    })
  );
  app.post(
    '/api/character-templates',
    wrap(async (req, res) => {
      const input = z
        .object({
          name: z.string().min(1).max(MAX_ENTITY_NAME_CHARS),
          campaignId: idSchema,
          characterId: idSchema,
          revision: z.number().int().nonnegative(),
        })
        .strict()
        .parse(req.body);
      const template = await library!.characterTemplate(input);
      res.status(201).json({ data: template });
    })
  );
  app.delete(
    '/api/character-templates/:id',
    wrap(async (req, res) => {
      z.object({}).strict().parse(req.body);
      await library!.deleteTemplate('character', param(req, 'id'));
      res.json({ data: { deleted: true } });
    })
  );
  app.post(
    '/api/campaigns/:id/characters/from-template',
    wrap(async (req, res) => {
      const input = z
        .object({ templateId: idSchema, revision: z.number().int().nonnegative() })
        .strict()
        .parse(req.body);
      const c = await library!.instantiateCharacter(
        param(req, 'id'),
        input.templateId,
        input.revision
      );
      res.status(201).json({ data: publicCampaign(c) });
    })
  );
  app.get(
    '/api/templates',
    wrap(async (req, res) => {
      const { limit, offset } = page(req);
      const items = await library!.listTemplates('campaign', limit + 1, offset);
      res.json({
        data: items.slice(0, limit),
        pagination: { nextCursor: items.length > limit ? String(offset + limit) : null },
      });
    })
  );
  app.post(
    '/api/templates',
    wrap(async (req, res) => {
      const input = z
        .object({
          name: z.string().min(1).max(MAX_ENTITY_NAME_CHARS),
          campaignId: idSchema,
          revision: z.number().int().nonnegative(),
        })
        .strict()
        .parse(req.body);
      res
        .status(201)
        .json({ data: await library!.template(input.name, input.campaignId, input.revision) });
    })
  );
  app.delete(
    '/api/templates/:id',
    wrap(async (req, res) => {
      z.object({}).strict().parse(req.body);
      await library!.deleteTemplate('campaign', param(req, 'id'));
      res.json({ data: { deleted: true } });
    })
  );
  app.post(
    '/api/templates/:id/campaigns',
    wrap(async (req, res) => {
      const { name } = z
        .object({ name: z.string().min(1).max(MAX_ENTITY_NAME_CHARS).optional() })
        .strict()
        .parse(req.body);
      res
        .status(201)
        .json({ data: publicCampaign(await library!.instantiate(param(req, 'id'), name)) });
    })
  );
  app.use('/api', (_req, _res, next) =>
    next(new Problem(404, 'not_found', 'API endpoint not found'))
  );
  const frontend = options.frontendDir ?? path.resolve(appRoot, '../rpg_fe_local/dist');
  app.use(express.static(frontend));
  app.get('/{*path}', (_req, res) => {
    res.sendFile(path.join(frontend, 'index.html'), (error) => {
      if (error)
        res
          .status(503)
          .type('text')
          .send(
            'Frontend build is missing. Run npm run build from the repository root, then npm start.'
          );
    });
  });
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    const problem =
      error instanceof Problem
        ? error
        : error instanceof z.ZodError
          ? new Problem(
              422,
              'validation',
              'Invalid input: ' +
                error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
            )
          : error instanceof multer.MulterError
            ? new Problem(413, 'upload_limit', 'Upload exceeds allowed size or file count')
            : operationalProblem(error);
    res
      .status(problem.status)
      .type('application/problem+json')
      .json({
        type: `urn:local-rpg:error:${problem.code}`,
        title: problem.code.replaceAll('_', ' '),
        status: problem.status,
        detail: problem.message,
        code: problem.code,
      });
  };
  app.use(errorHandler);
  return { app, turns, lan };
}
