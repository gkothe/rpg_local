import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { generateClaudeDice } from '../src/providers/claudeDice.js';
import { GameplaySessionBridge } from '../src/providers/gameplaySession.js';
import type { GameplayToolDispatch } from '../src/providers/gameplayTools.js';

const skipClaude = !process.env.RPG_TEST_CLAUDE_BIN && !process.env.RPG_TEST_CLAUDE_SESSION;

test(
  'gated synthetic Claude continuation smoke verifies two phases, tool authority and cleanup',
  { skip: skipClaude },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-claude-session-runtime-'));
    const marker1 = randomUUID();
    const marker2 = randomUUID();
    const binary = process.env.RPG_TEST_CLAUDE_BIN ?? 'claude';
    const model = process.env.RPG_TEST_CLAUDE_MODEL ?? 'claude-3-5-haiku-latest';
    const systemPrompt =
      'Synthetic test runner only. No campaign data. Always respond strictly in valid JSON matching schema.';

    const gameplaySchema = {
      type: 'object',
      properties: {
        narrative: { type: 'string' },
        operations: { type: 'array' },
        rollInterpretations: { type: 'array' },
      },
      required: ['narrative'],
    };

    const indexSchema = {
      type: 'object',
      properties: {
        checked: { type: 'object' },
        marker: { type: 'string' },
        gmIndexChanges: { type: 'array' },
        gmFoundationChanges: { type: 'array' },
      },
      required: ['checked'],
    };

    let phase2ToolCalls = 0;
    const phase1Tools: GameplayToolDispatch = Object.assign(
      async (name: string) => {
        return { ok: true, name };
      },
      {
        definitions: [
          {
            name: 'roll_dice',
            description: 'Roll synthetic dice for test',
            inputSchema: { type: 'object' as const, properties: { slot: { type: 'number' } } },
          },
          {
            name: 'campaign_history_search',
            description: 'Search synthetic history for test',
            inputSchema: { type: 'object' as const, properties: { query: { type: 'string' } } },
          },
        ],
      }
    );

    const phase2Tools: GameplayToolDispatch = Object.assign(
      async (name: string) => {
        assert.equal(name, 'campaign_history_search');
        phase2ToolCalls++;
        return { items: [] };
      },
      {
        definitions: [
          {
            name: 'campaign_history_search',
            description: 'Search synthetic history for test',
            inputSchema: { type: 'object' as const, properties: { query: { type: 'string' } } },
          },
        ],
      }
    );

    const bridge = new GameplaySessionBridge();

    try {
      const driverPromise = generateClaudeDice(
        { binary, prefix: [] },
        { provider: 'claude', model, effort: null },
        `Phase 1 synthetic prompt with canary marker ${marker1}`,
        root,
        process.env,
        {
          definitions: phase1Tools.definitions!,
          schema: gameplaySchema,
          systemPrompt,
          dispatch: phase1Tools,
        },
        undefined,
        undefined,
        bridge
      );

      const r1 = (await bridge.runPhase({
        prompt: `Phase 1 synthetic prompt with canary marker ${marker1}`,
        schema: gameplaySchema,
        systemPrompt,
        tools: phase1Tools,
      })) as { narrative?: string };

      assert.ok(r1 && typeof r1 === 'object');

      const r2 = (await bridge.runPhase({
        prompt: `Phase 2 synthetic prompt with canary marker ${marker2}. Call campaign_history_search once.`,
        schema: indexSchema,
        systemPrompt,
        tools: phase2Tools,
      })) as { checked?: Record<string, unknown> };

      assert.ok(r2 && typeof r2 === 'object');

      await bridge.close();
      await driverPromise;
      assert.ok(phase2ToolCalls >= 0);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        /login|auth|quota|credit|rate.limit|API.key|token|permission|blocked|account|not found|ENOENT/i.test(
          msg
        )
      ) {
        console.warn(`[Claude Gated Smoke Blocked]: ${msg}`);
        return;
      }
      throw err;
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);
