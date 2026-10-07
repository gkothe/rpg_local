import { expect, test } from '@playwright/test';
import { fixtureCampaign, fixtureTurn, options, providers } from '../fixtures';

const campaign = fixtureCampaign();
const turn = fixtureTurn();
const base = `/api/campaigns/${campaign.id}/memory/rebuilds`;
const DIGEST = 'b'.repeat(64);

const job = (over: Record<string, unknown> = {}) => ({
  id: 'rebuild-1',
  campaignId: campaign.id,
  status: 'running',
  statusLabel: 'Rebuilding',
  active: true,
  processedTurns: 0,
  totalTurns: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  errorCode: null,
  safeError: null,
  allowedActions: ['cancel'],
  baseline: { id: 'm0', text: 'Old thin summary', coveredTurnIds: [], valid: true },
  candidate: null,
  decision: null,
  ...over,
});

/** A stateful stand-in for the rebuild API; the draft changes campaign memory only on apply. */
async function mockApi(page: import('@playwright/test').Page) {
  let current: ReturnType<typeof job> | null = null;
  let polls = 0;
  let memoryText = 'Old thin summary';
  const requests: { method: string; path: string; body: string }[] = [];
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
        memoryRebuild: {
          actionOptions: [
            { id: 'cancel', label: 'Cancel' },
            { id: 'resume', label: 'Retry' },
            { id: 'apply', label: 'Apply' },
            { id: 'discard', label: 'Discard' },
          ],
        },
      };
    else if (path === '/api/providers') result = providers;
    else if (path === `/api/campaigns/${campaign.id}`)
      result = {
        ...campaign,
        memory: { id: 'm0', text: memoryText, coveredTurnIds: [], valid: true, createdAt: '' },
        turns: [turn],
      };
    else if (path === `${base}` && method === 'POST') {
      current = job({ processedTurns: 1 });
      result = current;
    } else if (path === `${base}`)
      result = { jobs: current ? [current] : [], current, nextCursor: null };
    else if (path === `${base}/rebuild-1` && method === 'GET') {
      polls++;
      if (polls >= 2)
        current = job({
          status: 'ready',
          statusLabel: 'Ready to review',
          active: false,
          processedTurns: 3,
          allowedActions: ['apply', 'discard'],
          candidate: {
            text: '- Rebuilt with the arena and the Embrace',
            coveredTurnIds: ['a', 'b', 'c'],
            proposalDigest: DIGEST,
          },
        });
      result = current;
    } else if (path === `${base}/rebuild-1/apply`) {
      memoryText = '- Rebuilt with the arena and the Embrace';
      current = job({
        status: 'applied',
        statusLabel: 'Applied',
        active: false,
        allowedActions: [],
        candidate: current!.candidate,
        decision: { action: 'apply', requestId: 'r', memoryId: 'm1' },
      });
      result = { campaign, job: current };
    } else if (path.includes('/journal/entries'))
      result = { entries: [], groups: [], total: 0, nextCursor: null };
    else result = [campaign];
    await route.fulfill({ status: 200, json: { data: result } });
  });
  return { requests, memory: () => memoryText };
}

test('rebuild progress, reload recovery, review and apply', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto(`/campaigns/${campaign.id}?tab=journal`);
  await page.getByRole('tab', { name: 'Campaign memory' }).click();
  await expect(page.getByText('Old thin summary').first()).toBeVisible();
  await page.getByRole('button', { name: 'Rebuild memory' }).click();
  await expect(page.getByText(/Rebuilding: 1 of 3 turns summarized/)).toBeVisible();
  // Leaving and returning restores the running job instead of starting another.
  await page.reload();
  await page.getByRole('tab', { name: 'Campaign memory' }).click();
  await expect(page.getByText(/Rebuilding: 1 of 3 turns summarized/)).toBeVisible();
  await expect(page.getByText('Ready to review')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Covers 3 turns.')).toBeVisible();
  // The draft is only a draft until Apply.
  expect(api.memory()).toBe('Old thin summary');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Applied')).toBeVisible();
  expect(api.memory()).toBe('- Rebuilt with the arena and the Embrace');
  const applies = api.requests.filter((r) => r.path.endsWith('/apply'));
  expect(applies).toHaveLength(1);
  expect(JSON.parse(applies[0]!.body).proposalDigest).toBe(DIGEST);
  expect(api.requests.filter((r) => r.method === 'POST' && r.path === base)).toHaveLength(1);
});
