import { expect, test, type Page } from '@playwright/test';
import { fixtureCampaign, fixtureTurn, options, providers } from '../fixtures';

const campaign = fixtureCampaign();
const turn = fixtureTurn();
const DIGEST = 'c'.repeat(64);
const history = `/api/campaigns/${campaign.id}/history`;
const rebuilds = `/api/campaigns/${campaign.id}/memory/rebuilds`;

const status = (over: Record<string, unknown>) => ({
  enabled: false,
  activeOverviewId: null,
  protectedKnowledgeIds: [],
  protectedSectionIds: [],
  protectedMemoryIds: [],
  coveredTurns: 0,
  totalTurns: 11,
  searchableSections: 0,
  pendingRefresh: false,
  unavailableProtectedIds: [],
  diagnostics: {
    targetBytes: 16384,
    suppliedBytes: 0,
    mandatoryBytes: 0,
    overflowBytes: 0,
    included: [],
    omitted: { count: 0, reasonCounts: {} },
  },
  ...over,
});
const job = (over: Record<string, unknown> = {}) => ({
  id: 'prep-1',
  campaignId: campaign.id,
  purpose: 'compact_history',
  status: 'running',
  statusLabel: 'Rebuilding',
  active: true,
  processedTurns: 1,
  totalTurns: 4,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  errorCode: null,
  safeError: null,
  allowedActions: ['cancel'],
  baseline: null,
  candidate: null,
  compact: null,
  decision: null,
  ...over,
});

/** A stateful stand-in: preparing stages a draft; only Activate turns selective history on. */
async function mockApi(page: Page) {
  let enabled = false;
  let protectedSection = false;
  let current: ReturnType<typeof job> | null = null;
  let polls = 0;
  const requests: { method: string; path: string; body: string }[] = [];
  const section = (isProtected: boolean) => ({
    id: 'sec-1',
    title: 'The arena',
    kind: 'section',
    sourceTurnIds: ['t1'],
    startAt: null,
    endAt: null,
    excerpt: 'A fight in the arena and the Embrace.',
    protected: isProtected,
    available: true,
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    requests.push({ method, path, body: request.postData() ?? '' });
    let result: unknown;
    if (path === '/api/settings')
      result = {
        ...options,
        history: {
          kindOptions: [{ id: 'section', label: 'Section' }],
          reasonOptions: [{ id: 'searchable_only', label: 'Searchable only' }],
          limits: { pageSizeDefault: 20, originalsPageSize: 4, queryMaxChars: 200 },
        },
        memoryRebuild: {
          actionOptions: [
            { id: 'cancel', label: 'Cancel' },
            { id: 'apply', label: 'Apply' },
            { id: 'discard', label: 'Discard' },
          ],
        },
      };
    else if (path === '/api/providers') result = providers;
    else if (path === `/api/campaigns/${campaign.id}`) result = { ...campaign, turns: [turn] };
    else if (path === history && method === 'GET')
      result = {
        items: [section(protectedSection)],
        nextCursor: null,
        status: status({
          enabled,
          searchableSections: 1,
          protectedSectionIds: protectedSection ? ['sec-1'] : [],
        }),
      };
    else if (path === `${history}/sec-1`)
      result = {
        item: { id: 'sec-1', title: 'The arena', kind: 'section', text: 't', protected: false },
        originals: [
          { turnId: 't1', player: 'enter the arena', gm: 'The crowd roars.', createdAt: '' },
        ],
        nextCursor: null,
        correctionGuidance: { instruction: '', items: [] },
      };
    else if (path === `${history}/protection/sections/sec-1`) {
      protectedSection = JSON.parse(request.postData() ?? '{}').protected;
      result = {
        status: status({ enabled, protectedSectionIds: protectedSection ? ['sec-1'] : [] }),
      };
    } else if (path === `${history}/settings`) {
      enabled = false;
      result = { status: status({ enabled }) };
    } else if (path === rebuilds && method === 'POST') {
      current = job();
      result = current;
    } else if (path === rebuilds)
      result = { jobs: current ? [current] : [], current, nextCursor: null };
    else if (path === `${rebuilds}/prep-1` && method === 'GET') {
      polls++;
      if (polls >= 2)
        current = job({
          status: 'ready',
          statusLabel: 'Ready to review',
          active: false,
          processedTurns: 4,
          allowedActions: ['apply', 'discard'],
          compact: { sections: 2, chapters: 1 },
          candidate: {
            text: '- A short overview',
            coveredTurnIds: ['a', 'b'],
            proposalDigest: DIGEST,
          },
        });
      result = current;
    } else if (path === `${rebuilds}/prep-1/apply`) {
      enabled = true;
      current = job({
        status: 'applied',
        statusLabel: 'Applied',
        active: false,
        allowedActions: [],
        decision: { action: 'apply', requestId: 'r', memoryId: null },
      });
      result = { campaign, job: current };
    } else if (path.includes('/journal/entries'))
      result = { entries: [], groups: [], total: 0, nextCursor: null };
    else result = [campaign];
    await route.fulfill({ status: 200, json: { data: result } });
  });
  return { requests };
}

test('search, originals, protection, prepare, review, activate and turn off', async ({ page }) => {
  const api = await mockApi(page);
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto(`/campaigns/${campaign.id}?tab=journal`);
  await page.getByRole('tab', { name: 'History recall' }).click();
  await expect(page.getByText('The arena', { exact: true })).toBeVisible();
  await expect(page.getByText('Selective history is off.')).toBeVisible();
  await page.getByRole('button', { name: 'Show originals' }).click();
  await expect(page.getByText('The crowd roars.')).toBeVisible();
  await page.getByRole('button', { name: 'Protect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unprotect', exact: true })).toBeVisible();
  // Reload keeps the protection because the server owns it.
  await page.reload();
  await page.getByRole('tab', { name: 'History recall' }).click();
  await expect(page.getByRole('button', { name: 'Unprotect', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Prepare compact history' }).click();
  await expect(page.getByText('Review before activating')).toBeVisible({ timeout: 10_000 });
  expect(api.requests.filter((r) => r.path.endsWith('/apply'))).toHaveLength(0);
  await page.getByRole('button', { name: 'Activate' }).click();
  await expect(page.getByText('Selective history is on.')).toBeVisible();
  const applies = api.requests.filter((r) => r.path.endsWith('/apply'));
  expect(applies).toHaveLength(1);
  expect(JSON.parse(applies[0]!.body).proposalDigest).toBe(DIGEST);
  await page.getByRole('button', { name: 'Turn off selective history' }).click();
  await expect(page.getByText('Selective history is off.')).toBeVisible();
});

test('history panel fits a phone without horizontal scrolling', async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/campaigns/${campaign.id}?tab=journal`);
  await page.getByRole('tab', { name: 'History recall' }).click();
  await expect(page.getByText('The arena', { exact: true })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
