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
import {
  audioDiagnostics,
  extractFile,
  extractGoogle,
  textSource,
  transcribe,
} from './services/sources.js';
import { Problem } from './errors.js';
import { appRoot, uploadBytes } from './config.js';
import {
  campaignCreateSchema,
  campaignPatchSchema,
  characterInput,
  idSchema,
  turnInputSchema,
} from './domain/schemas.js';
import { accessBoundary, LanAccess } from './security.js';
import {
  TURN_STATUS_OPTIONS,
  CHARACTER_TYPE_OPTIONS,
  SOURCE_KIND_OPTIONS,
  SOURCE_STATUS_OPTIONS,
  OCR_LANGUAGE_OPTIONS,
  TRANSCRIPTION_LANGUAGE_OPTIONS,
  CONTEXT_DEFAULTS,
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
  const sources = store ? new SourceLibrary(store) : null;
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
          version: 1,
          turnStatuses: TURN_STATUS_OPTIONS.map((x) => x.id),
          sourceKinds: SOURCE_KIND_OPTIONS.map((x) => x.id),
          characterTypes: CHARACTER_TYPE_OPTIONS.map((x) => x.id),
          turnStatusOptions: TURN_STATUS_OPTIONS,
          characterTypeOptions: CHARACTER_TYPE_OPTIONS,
          sourceKindOptions: SOURCE_KIND_OPTIONS,
          sourceStatusOptions: SOURCE_STATUS_OPTIONS,
          ocrLanguageOptions: OCR_LANGUAGE_OPTIONS,
          transcriptionLanguageOptions: TRANSCRIPTION_LANGUAGE_OPTIONS,
          defaults: {
            characterType: 'player',
            ocrLanguage: 'eng',
            transcriptionLanguage: 'auto',
            budgets: CONTEXT_DEFAULTS,
          },
          audio: await audioDiagnostics(),
          lan: { enabled: options.lan ?? false },
          limits: { uploadBytes },
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
      res.json({ data: await transcribe(req.file.buffer, String(req.body.language ?? 'auto')) });
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
  app.get(
    '/api/campaigns',
    wrap(async (req, res) => {
      const { limit, offset } = page(req);
      const items = await store!.list(limit + 1, offset);
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
      res.status(201).json({ data: c });
    })
  );
  app.post(
    '/api/campaigns/import',
    wrap(async (req, res) => {
      const { archive } = z.object({ archive: z.unknown() }).strict().parse(req.body);
      const c = await library!.import(archive);
      res.status(201).json({ data: { ...c, turns: await store!.turns(c.id) } });
    })
  );
  app.get(
    '/api/campaigns/:id',
    wrap(async (req, res) => {
      const id = param(req, 'id');
      const c = await store!.campaign(id);
      res.json({ data: { ...c, turns: await store!.recentTurns(id) } });
    })
  );
  app.patch(
    '/api/campaigns/:id',
    wrap(async (req, res) => {
      const { revision, ...patch } = campaignPatchSchema.parse(req.body);
      const c = await campaigns!.patch(param(req, 'id'), revision, patch);
      res.json({ data: c });
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
        .object({ notes: z.string().max(100000), notesRevision: z.number().int().nonnegative() })
        .strict()
        .parse(req.body);
      const c = await campaigns!.notes(param(req, 'id'), input);
      res.json({ data: c });
    })
  );
  app.post(
    '/api/campaigns/:id/characters',
    wrap(async (req, res) => {
      const { revision, ...input } = characterInput
        .extend({ revision: z.number().int().nonnegative() })
        .parse(req.body);
      const c = await campaigns!.addCharacter(param(req, 'id'), revision, input);
      res.status(201).json({ data: c });
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
      res.json({ data: c });
    })
  );
  app.delete(
    '/api/campaigns/:id/characters/:characterId',
    wrap(async (req, res) => {
      const { revision } = revisionSchema.parse(req.body);
      const characterId = param(req, 'characterId');
      const c = await campaigns!.deleteCharacter(param(req, 'id'), characterId, revision);
      res.json({ data: c });
    })
  );
  app.post(
    '/api/campaigns/:id/sources',
    wrap(async (req, res) => {
      const { revision, name, text } = z
        .object({
          revision: z.number().int().nonnegative(),
          name: z.string().min(1).max(200),
          text: z.string().max(10 * 1024 * 1024),
        })
        .strict()
        .parse(req.body);
      const c = await sources!.add(param(req, 'id'), revision, textSource(name, text));
      res.status(201).json({ data: c });
    })
  );
  app.post(
    '/api/campaigns/:id/sources/extract',
    upload.single('file'),
    wrap(async (req, res) => {
      const id = param(req, 'id');
      const revision = z.coerce.number().int().nonnegative().parse(req.body.revision);
      const language = z.enum(['eng', 'por', 'eng+por']).default('eng').parse(req.body.language);
      const source = req.file
        ? await extractFile(req.file.buffer, req.file.originalname, language)
        : await extractGoogle(
            z.string().max(2000).parse(req.body.url),
            z.string().max(200).optional().parse(req.body.name)
          );
      const c = await sources!.add(id, revision, source, req.file?.buffer);
      res.status(201).json({ data: c });
    })
  );
  app.patch(
    '/api/campaigns/:id/sources/:sourceId',
    wrap(async (req, res) => {
      const input = z
        .object({
          revision: z.number().int().nonnegative(),
          text: z
            .string()
            .min(1)
            .max(10 * 1024 * 1024),
          name: z.string().min(1).max(200).optional(),
          confirmed: z.boolean(),
        })
        .strict()
        .parse(req.body);
      const sourceId = param(req, 'sourceId');
      const c = await sources!.correct(param(req, 'id'), sourceId, input);
      res.json({ data: c });
    })
  );
  app.delete(
    '/api/campaigns/:id/sources/:sourceId',
    wrap(async (req, res) => {
      const { revision } = revisionSchema.parse(req.body);
      const sourceId = param(req, 'sourceId');
      const c = await sources!.delete(param(req, 'id'), sourceId, revision);
      res.json({ data: c });
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
      const items = await store!.turns(id, undefined, limit + 1, offset);
      res.json({
        data: items.slice(0, limit),
        pagination: { nextCursor: items.length > limit ? String(offset + limit) : null },
      });
    })
  );
  app.post(
    '/api/campaigns/:id/turns',
    wrap(async (req, res) => {
      res
        .status(202)
        .json({ data: await turns!.submit(param(req, 'id'), turnInputSchema.parse(req.body)) });
    })
  );
  app.get(
    '/api/campaigns/:id/turns/:turnId',
    wrap(async (req, res) => {
      res.json({ data: await store!.turn(param(req, 'id'), param(req, 'turnId')) });
    })
  );
  app.post(
    '/api/campaigns/:id/turns/:turnId/cancel',
    wrap(async (req, res) => {
      z.object({}).strict().parse(req.body);
      res.json({ data: await turns!.cancel(param(req, 'id'), param(req, 'turnId')) });
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
            res.write(`event: status\ndata: ${JSON.stringify(t)}\n\n`);
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
      res.json({ data: { ...c, turns: await store!.recentTurns(id) } });
    })
  );
  app.post(
    '/api/campaigns/:id/memory',
    wrap(async (req, res) => {
      const input = z
        .object({
          revision: z.number().int().nonnegative(),
          text: z.string().trim().min(1).max(16000),
          coveredTurnIds: z.array(idSchema),
          confirm: z.literal(true),
        })
        .strict()
        .parse(req.body);
      res.json({ data: await turns!.manualMemory(param(req, 'id'), input) });
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
          name: z.string().min(1).max(200),
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
      res.status(201).json({ data: c });
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
          name: z.string().min(1).max(200),
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
        .object({ name: z.string().min(1).max(200).optional() })
        .strict()
        .parse(req.body);
      res.status(201).json({ data: await library!.instantiate(param(req, 'id'), name) });
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
            : new Problem(
                503,
                'local_service',
                'Local service failed; check PostgreSQL setup/migrations and local runtime diagnostics'
              );
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
