import { expect, test, type Page } from '@playwright/test';
import { fixtureCampaign, fixtureTurn, options, providers } from '../fixtures';

const campaign = fixtureCampaign();
const base = `/api/campaigns/${campaign.id}`;
const digest = 'a'.repeat(64);
async function mockApi(page: Page) {
  let enabled = false,
    prepared = false,
    current: Record<string, unknown> | null = null;
  let failNext = false,
    stale = false;
  const starts: Record<string, unknown>[] = [];
  const preview = {
    topics: [{ title: 'Mira', text: 'Mira offered to guide the party.' }],
    coverage: { turns: 5, sourceSections: 4, knowledge: 1 },
  };
  await page.route('**/api/**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    let data: unknown;
    if (path === '/api/settings')
      data = {
        ...options,
        gmIndex: {
          purposeId: 'gm_index',
          modes: [
            { id: 'prepare', label: 'Prepare GM index' },
            { id: 'fresh_rebuild', label: 'Rebuild index from scratch' },
          ],
          finalizationStages: [],
        },
        memoryRebuild: {
          actionOptions: [
            { id: 'apply', label: 'Apply' },
            { id: 'discard', label: 'Discard' },
            { id: 'resume', label: 'Retry' },
          ],
        },
      };
    else if (path === '/api/providers') data = providers;
    else if (path === base) data = { ...campaign, turns: [fixtureTurn()] };
    else if (path === `${base}/gm-index`)
      data = {
        enabled,
        prepared,
        canPrepare: true,
        blockedReason: null,
        refreshRequired: false,
        playerKnown: preview,
      };
    else if (path === `${base}/gm-index/disable`) {
      enabled = false;
      data = {};
    } else if (path === `${base}/memory/rebuilds` && req.method() === 'POST') {
      const body = req.postDataJSON();
      starts.push(body);
      current = {
        id: 'index-job',
        campaignId: campaign.id,
        purpose: 'gm_index',
        status: failNext ? 'failed' : 'ready',
        statusLabel: failNext ? 'Failed' : 'Ready to review',
        active: false,
        processedTurns: 4,
        totalTurns: 4,
        allowedActions: failNext ? ['discard'] : ['apply', 'discard'],
        candidate: failNext ? null : { text: '', coveredTurnIds: [], proposalDigest: digest },
        gmIndex: { mode: body.mode, preview: failNext ? null : preview },
        baseline: null,
        safeError: failNext ? 'Provider unavailable; existing index is kept.' : null,
        decision: null,
      };
      data = current;
    } else if (path === `${base}/memory/rebuilds`)
      data = { current, jobs: current ? [current] : [], nextCursor: null };
    else if (path.endsWith('/index-job/apply')) {
      if (stale) {
        await route.fulfill({
          status: 409,
          json: { detail: 'The story changed; prepare a new index.' },
        });
        return;
      }
      if ((current?.gmIndex as { mode: string }).mode === 'prepare') enabled = true;
      prepared = true;
      current = {
        ...current,
        status: 'applied',
        statusLabel: 'Applied',
        allowedActions: [],
        decision: { action: 'apply' },
      };
      data = { campaign, job: current };
    } else if (path.endsWith('/index-job/discard')) {
      current = {
        ...current,
        status: 'discarded',
        allowedActions: [],
        decision: { action: 'discard' },
      };
      data = { campaign, job: current };
    } else if (path === `${base}/history`)
      data = {
        items: [],
        nextCursor: null,
        status: {
          enabled,
          totalTurns: 5,
          coveredTurns: 0,
          searchableSections: 0,
          protectedKnowledgeIds: [],
          protectedSectionIds: [],
          protectedMemoryIds: [],
          unavailableProtectedIds: [],
          diagnostics: {
            overflowBytes: 0,
            suppliedBytes: 0,
            targetBytes: 16384,
            mandatoryBytes: 0,
            omitted: { reasonCounts: {} },
          },
        },
      };
    else if (path.includes('/journal/entries'))
      data = { entries: [], groups: [], total: 0, nextCursor: null };
    else data = [campaign];
    await route.fulfill({ status: 200, json: { data } });
  });
  return {
    starts,
    fail: () => {
      failNext = true;
    },
    makeStale: () => {
      stale = true;
    },
  };
}
async function open(page: Page) {
  await page.goto(`/campaigns/${campaign.id}?tab=journal`);
  await page.getByRole('tab', { name: 'History recall' }).click();
  return page.getByRole('region', { name: 'GM working index' });
}
test('prepare, safe review, activation and fresh replacement preserve disabled mode', async ({
  page,
}) => {
  const api = await mockApi(page),
    panel = await open(page);
  await panel.getByRole('button', { name: 'Prepare GM index' }).click();
  await expect(
    panel.getByText('Checked 5 turns, 4 source sections and 1 knowledge records.')
  ).toBeVisible();
  await panel.getByText('Player-known topics (1)').click();
  await expect(panel.getByText('Mira offered to guide the party.')).toBeVisible();
  await expect(panel.getByText('Not enabled.')).toBeVisible();
  await panel.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Disable GM index' })).toBeVisible();
  await panel.getByRole('button', { name: 'Disable GM index' }).click();
  await panel.getByRole('button', { name: 'Rebuild index from scratch' }).click();
  await panel.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(panel.getByText('Not enabled.')).toBeVisible();
  expect(api.starts.map((body) => body.mode)).toEqual(['prepare', 'fresh_rebuild']);
  expect(await page.content()).not.toContain('secret GM plan');
});
test('failed fresh rebuild keeps the active index and fits a phone', async ({ page }) => {
  const api = await mockApi(page);
  await page.setViewportSize({ width: 360, height: 800 });
  const panel = await open(page);
  await panel.getByRole('button', { name: 'Prepare GM index' }).click();
  await panel.getByRole('button', { name: 'Apply', exact: true }).click();
  api.fail();
  await panel.getByRole('button', { name: 'Rebuild index from scratch' }).click();
  await expect(panel.getByText('Provider unavailable; existing index is kept.')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Disable GM index' })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
  ).toBeLessThanOrEqual(0);
});
test('changed target rejects applying the reviewed draft', async ({ page }) => {
  const api = await mockApi(page),
    panel = await open(page);
  await panel.getByRole('button', { name: 'Prepare GM index' }).click();
  api.makeStale();
  await panel.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(panel.getByText('The story changed; prepare a new index.')).toBeVisible();
  await expect(panel.getByText('Not enabled.')).toBeVisible();
});
