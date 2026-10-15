import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Problem } from '../src/errors.js';
import type { Generator, ProviderService } from '../src/providers/service.js';
import { TurnStatus } from '../src/domain/options.js';
import { GmIndexEntryKind } from '../src/domain/gmIndex.js';
import { KnowledgeVisibility } from '../src/domain/knowledge.js';
import { GM_INDEX_OPTIONS } from '../src/services/gmIndexStatus.js';
import {
  dbEnabled,
  openIsolatedStore,
  seedCampaign,
  knowledgeRecord,
  sleep,
} from './journalFixture.js';
import { gmResponse, syntheticGenerate } from './ownedGameplayFixture.js';

const headers = { Host: 'localhost:4100', 'X-RPG-Client': 'local-rpg' };
const PRIVATE = 'HTTP_PRIVATE_INDEX_MARKER';
const NARRATIVE = 'HTTP_STAGED_NARRATIVE_MARKER';

function provider() {
  let failed = false;
  const calls = { gameplay: 0, editor: 0, updater: 0 };
  const edit = syntheticGenerate();
  const generator: Generator = {
    capacity: async () => 16000,
    gameplayCapacity: async () => 16000,
    generate: async (...args) => {
      calls.editor++;
      assert.doesNotMatch(args[1], /HTTP_PRIVATE_INDEX_MARKER/);
      return edit(...args);
    },
    generateOwnedGameplay: async (_settings, prompt, schema) => {
      const properties = (schema as { properties: Record<string, unknown> }).properties;
      if ('checked' in properties) {
        calls.updater++;
        if (!failed) {
          failed = true;
          throw new Problem(429, 'provider_quota', 'Synthetic index quota failure');
        }
        return {
          checked: { notes: true, foundation: true, direction: true },
          gmIndexChanges: [],
          gmFoundationChanges: [],
        };
      }
      if ('narrative' in properties) {
        calls.gameplay++;
        return gmResponse(NARRATIVE, [], {
          gmIndexHandoff: [{ kind: GmIndexEntryKind.GmPlan, text: PRIVATE, refs: [] }],
        });
      }
      const input = JSON.parse(prompt);
      if (input.stage === 'scan') return { foundation: [] };
      assert.equal(input.stage, 'synthesize');
      return {
        foundation: [],
        entries: [
          {
            kind: 'gm_plan',
            status: 'active',
            title: 'Private proposal',
            text: PRIVATE,
            ownerCharacterId: null,
            refs: [],
            direction: null,
          },
        ],
      };
    },
  };
  return { generator, calls };
}

async function fixture() {
  const isolated = await openIsolatedStore('gm_index_http');
  const { campaign } = await seedCampaign(
    isolated.store,
    [],
    [
      knowledgeRecord('Public lead', 'The trader offers armor.'),
      knowledgeRecord('Private lead', PRIVATE, { visibility: KnowledgeVisibility.GmOnly }),
    ]
  );
  const ai = provider();
  const app = createApp({ store: isolated.store, providers: ai.generator as ProviderService }).app;
  return { ...isolated, campaign, ai, app, base: `/api/campaigns/${campaign.id}` };
}

async function prepare(f: Awaited<ReturnType<typeof fixture>>) {
  const started = await request(f.app)
    .post(`${f.base}/memory/rebuilds`)
    .set(headers)
    .send({ requestId: randomUUID(), purpose: 'gm_index', mode: 'prepare' })
    .expect(202);
  for (let i = 0; i < 500; i++) {
    const response = await request(f.app)
      .get(`${f.base}/memory/rebuilds/${started.body.data.id}`)
      .set(headers)
      .expect(200);
    const job = response.body.data;
    if (!job.active) {
      assert.equal(job.status, 'ready', job.safeError ?? '');
      return job;
    }
    await sleep(10);
  }
  throw new Error('HTTP index preparation did not finish');
}

test(
  'HTTP advertises index options, validates modes, and exposes only safe review/apply/disable DTOs',
  { skip: !dbEnabled },
  async () => {
    const f = await fixture();
    try {
      const settings = await request(f.app).get('/api/settings').set(headers).expect(200);
      assert.deepEqual(settings.body.data.gmIndex, GM_INDEX_OPTIONS);
      const status = await request(f.app).get(`${f.base}/gm-index`).set(headers).expect(200);
      assert.equal(status.body.data.prepared, false);
      assert.doesNotMatch(JSON.stringify(status.body), /HTTP_PRIVATE_INDEX_MARKER/);
      await request(f.app)
        .post(`${f.base}/memory/rebuilds`)
        .set(headers)
        .send({ requestId: randomUUID(), purpose: 'gm_index', mode: 'invalid' })
        .expect(422);
      await request(f.app)
        .post(`${f.base}/memory/rebuilds`)
        .set(headers)
        .send({ requestId: randomUUID(), purpose: 'memory', mode: 'fresh_rebuild' })
        .expect(422);
      assert.deepEqual(f.ai.calls, { gameplay: 0, editor: 0, updater: 0 });
      const job = await prepare(f);
      assert.equal(job.gmIndex.mode, 'prepare');
      assert.deepEqual(job.gmIndex.preview.topics, [
        { title: 'Public lead', text: 'The trader offers armor.' },
      ]);
      assert.equal(job.candidate.text, '');
      assert.doesNotMatch(JSON.stringify(job), /HTTP_PRIVATE_INDEX_MARKER/);
      assert.equal((await f.store.campaign(f.campaign.id)).gmIndex, undefined);
      const applied = await request(f.app)
        .post(`${f.base}/memory/rebuilds/${job.id}/apply`)
        .set(headers)
        .send({ requestId: randomUUID(), proposalDigest: job.candidate.proposalDigest })
        .expect(200);
      assert.doesNotMatch(JSON.stringify(applied.body), /HTTP_PRIVATE_INDEX_MARKER/);
      assert.equal((await f.store.campaign(f.campaign.id)).gmIndex!.settings.enabled, true);
      const disableId = randomUUID();
      const disabled = await request(f.app)
        .post(`${f.base}/gm-index/disable`)
        .set(headers)
        .send({ requestId: disableId, expectedEnabled: true })
        .expect(200);
      assert.equal(disabled.body.data.status.enabled, false);
      const revision = (await f.store.campaign(f.campaign.id)).revision;
      await request(f.app)
        .post(`${f.base}/gm-index/disable`)
        .set(headers)
        .send({ requestId: disableId, expectedEnabled: true })
        .expect(200);
      assert.equal((await f.store.campaign(f.campaign.id)).revision, revision);
    } finally {
      await f.close();
    }
  }
);

test(
  'pending index output stays withheld on GET, campaign and SSE until resume-finalization completes',
  { skip: !dbEnabled },
  async () => {
    const f = await fixture();
    try {
      const job = await prepare(f);
      await request(f.app)
        .post(`${f.base}/memory/rebuilds/${job.id}/apply`)
        .set(headers)
        .send({ requestId: randomUUID(), proposalDigest: job.candidate.proposalDigest })
        .expect(200);
      const submitted = await request(f.app)
        .post(`${f.base}/turns`)
        .set(headers)
        .send({
          revision: (await f.store.campaign(f.campaign.id)).revision,
          requestId: randomUUID(),
          action: 'Return home.',
        })
        .expect(202);
      const turnId = submitted.body.data.id;
      for (let i = 0; i < 500; i++) {
        if ((await f.store.turn(f.campaign.id, turnId)).status === TurnStatus.Failed) break;
        await sleep(10);
      }
      const pending = await request(f.app)
        .get(`${f.base}/turns/${turnId}`)
        .set(headers)
        .expect(200);
      assert.equal(pending.body.data.status, 'failed');
      assert.equal(pending.body.data.finalization.stage, 'index_updating');
      assert.equal(pending.body.data.editingPending, true);
      assert.equal(pending.body.data.narrative, null);
      assert.deepEqual(pending.body.data.changes, []);
      for (const field of [
        'rollInterpretations',
        'ruleCitations',
        'operationExplanations',
        'combatEffects',
        'participantReferences',
      ])
        assert.equal(pending.body.data[field], undefined);
      const campaign = await request(f.app).get(f.base).set(headers).expect(200);
      assert.doesNotMatch(
        JSON.stringify(campaign.body),
        /HTTP_PRIVATE_INDEX_MARKER|HTTP_STAGED_NARRATIVE_MARKER/
      );
      const stream = await request(f.app)
        .get(`${f.base}/turns/${turnId}/events`)
        .set(headers)
        .buffer(true)
        .parse((response, callback) => {
          let text = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => {
            text += chunk;
          });
          response.on('end', () => callback(null, text));
        })
        .expect(200);
      assert.match(String(stream.body), /index_updating/);
      assert.doesNotMatch(
        String(stream.body),
        /HTTP_PRIVATE_INDEX_MARKER|HTTP_STAGED_NARRATIVE_MARKER/
      );
      await request(f.app)
        .post(`${f.base}/turns/${turnId}/resume-finalization`)
        .set(headers)
        .send({ revision: (await f.store.campaign(f.campaign.id)).revision, requestId: 'bad' })
        .expect(422);
      const resumeInput = {
        revision: (await f.store.campaign(f.campaign.id)).revision,
        requestId: randomUUID(),
      };
      await request(f.app)
        .post(`${f.base}/turns/${turnId}/resume-finalization`)
        .set(headers)
        .send(resumeInput)
        .expect(202);
      for (let i = 0; i < 500; i++) {
        if ((await f.store.turn(f.campaign.id, turnId)).status === TurnStatus.Completed) break;
        await sleep(10);
      }
      const completed = await request(f.app)
        .get(`${f.base}/turns/${turnId}`)
        .set(headers)
        .expect(200);
      assert.equal(completed.body.data.status, 'completed');
      assert.equal(completed.body.data.narrative, NARRATIVE);
      assert.doesNotMatch(JSON.stringify(completed.body), /HTTP_PRIVATE_INDEX_MARKER/);
      await request(f.app)
        .post(`${f.base}/turns/${turnId}/resume-finalization`)
        .set(headers)
        .send(resumeInput)
        .expect(202);
      assert.deepEqual(f.ai.calls, { gameplay: 1, editor: 1, updater: 2 });
    } finally {
      await f.close();
    }
  }
);

test(
  'campaign HTTP persists the mode and rejects invalid or in-flight mode changes',
  { skip: !dbEnabled },
  async () => {
    const f = await fixture();
    try {
      await request(f.app)
        .patch(f.base)
        .set(headers)
        .send({ revision: 0, gmIndexUpdateMode: 'invented' })
        .expect(422);
      const saved = await request(f.app)
        .patch(f.base)
        .set(headers)
        .send({ revision: 0, gmIndexUpdateMode: 'same_gm_conversation' })
        .expect(200);
      assert.equal(saved.body.data.gmIndexUpdateMode, 'same_gm_conversation');
      const fetched = await request(f.app).get(f.base).set(headers).expect(200);
      assert.equal(fetched.body.data.gmIndexUpdateMode, 'same_gm_conversation');
      const id = randomUUID();
      await f.store.pool.query(
        "INSERT INTO turns(id,campaign_id,request_id,payload_hash,status,document) VALUES($1,$2,$3,'synthetic','pending',$4)",
        [
          id,
          f.campaign.id,
          randomUUID(),
          JSON.stringify({ id, campaignId: f.campaign.id, status: 'pending' }),
        ]
      );
      await request(f.app)
        .patch(f.base)
        .set(headers)
        .send({ revision: 0, gmIndexUpdateMode: 'separate_agent' })
        .expect(409);
    } finally {
      await f.close();
    }
  }
);
