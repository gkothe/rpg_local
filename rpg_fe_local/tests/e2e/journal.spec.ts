import { expect, test, type Page } from '@playwright/test';
import { fixtureCampaign, fixtureTurn, options, providers } from '../fixtures';

const campaign = fixtureCampaign();
const recent = fixtureTurn();
const OLD_TURN = '99999999-9999-4999-8999-999999999999';
const older = {
  ...fixtureTurn(),
  id: OLD_TURN,
  action: 'Ask Mira about her work',
  narrative: 'Mira says she is a sister of the temple.',
};
const base = `/api/campaigns/${campaign.id}/journal`;

type Entry = {
  id: string;
  title: string;
  kind: string;
  group: string;
  status: string;
  statusLabel: string;
  certainty: string;
  certaintyLabel: string;
  overview: string;
  excerpt: boolean;
  text: string;
  updatedAt: string;
  connections: { id: string; title: string; group: string }[];
  evidence: { id: string; kind: string; label: string; turnId?: string; available: boolean }[];
  history: { at: string; kind: string; origin: string; turnId: string | null; summary: string }[];
};
const entry = (over: Partial<Entry>): Entry => ({
  id: 'e-mira',
  title: 'Mira',
  kind: 'npc',
  group: 'people_places',
  status: 'active',
  statusLabel: 'Current',
  certainty: 'established',
  certaintyLabel: 'Known',
  overview: 'Mira is the innkeeper.',
  excerpt: false,
  text: 'Mira is the innkeeper.',
  updatedAt: '2026-01-02T00:00:00.000Z',
  connections: [],
  evidence: [
    {
      id: `turn-${OLD_TURN}`,
      kind: 'turn',
      label: 'Conversation',
      turnId: OLD_TURN,
      available: true,
    },
    {
      id: 'evidence-0',
      kind: 'campaign_source',
      label: 'Campaign notes (version 1)',
      available: true,
    },
  ],
  history: [
    {
      at: '2026-01-02T00:00:00.000Z',
      kind: 'recorded',
      origin: 'gm',
      turnId: OLD_TURN,
      summary: 'Recorded',
    },
  ],
  ...over,
});
const GROUPS = [
  { id: 'people_places', label: 'People and places' },
  { id: 'unfinished_business', label: 'Unfinished business' },
  { id: 'discoveries', label: 'Discoveries' },
];

/** A stateful stand-in for the Journal API that records every request. */
async function mockApi(page: Page) {
  const entries: Entry[] = [
    entry({}),
    entry({
      id: 'e-merchant',
      title: 'Missing merchant',
      kind: 'objective',
      group: 'unfinished_business',
      overview: 'Find the missing merchant.',
      text: 'Find the missing merchant.',
      updatedAt: '2026-01-01T00:00:00.000Z',
      evidence: [],
    }),
    entry({
      id: 'e-debt',
      title: 'Book return',
      kind: 'debt',
      group: 'unfinished_business',
      status: 'resolved',
      statusLabel: 'Completed',
      overview: 'Returned the healer book.',
      text: 'Returned the healer book.',
      updatedAt: '2025-12-01T00:00:00.000Z',
      evidence: [],
    }),
  ];
  const requests: { method: string; path: string; body: string; response: string }[] = [];
  let backfillPolls = 0;
  let currentKind: 'backfill' | 'check' = 'backfill';
  const finding = {
    outcome: 'proposed',
    outcomeLabel: 'Correction proposed',
    reason: 'Mira states it herself.',
    knowledgeId: 'e-mira',
    proposalDigest: 'a'.repeat(64),
    changes: [
      {
        field: 'text',
        label: 'Text',
        before: 'Mira is the innkeeper.',
        after: 'Mira is a sister of the temple.',
      },
    ],
    evidence: [{ turnId: OLD_TURN, field: 'narrative', quote: 'a sister of the temple' }],
  };
  const job = (over: Record<string, unknown>) => ({
    id: 'job-1',
    jobId: 'job-1',
    kind: 'backfill',
    status: 'running',
    statusLabel: 'Working',
    active: true,
    progress: { processedPairs: 0, eligiblePairs: 4, created: null, skipped: null },
    error: null,
    finding: null,
    decision: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const json = (data: unknown, status = 200) => route.fulfill({ status, json: { data } });
    let result: unknown;
    if (path === '/api/settings')
      result = {
        ...options,
        journal: { limits: { queryMaxChars: 200, pageSizeDefault: 20, explanationMaxChars: 2000 } },
      };
    else if (path === '/api/providers') result = providers;
    else if (path === `/api/campaigns/${campaign.id}`) result = { ...campaign, turns: [recent] };
    else if (path === `/api/campaigns/${campaign.id}/turns/${OLD_TURN}`) result = older;
    else if (path === `${base}/entries`) {
      const q = (url.searchParams.get('query') ?? '').toLowerCase();
      const past = url.searchParams.get('includePast') === 'true';
      const shown = entries
        .filter((e) => past || e.status === 'active')
        .filter((e) => !q || `${e.title} ${e.overview}`.toLowerCase().includes(q));
      result = {
        entries: shown,
        groups: GROUPS.map((g) => ({ ...g, count: shown.filter((e) => e.group === g.id).length })),
        total: shown.length,
        nextCursor: null,
      };
    } else if (path.startsWith(`${base}/entries/`) && path.includes('/evidence/'))
      result = {
        kind: 'campaign_source',
        label: 'Campaign notes (version 1)',
        quote: 'Mira keeps the ledger.',
        available: true,
      };
    else if (path.startsWith(`${base}/entries/`) && method === 'GET')
      result = entries.find((e) => path.endsWith(`/${e.id}`));
    else if (path === `${base}/backfills`) {
      currentKind = 'backfill';
      result = job({});
    } else if (path.endsWith('/checks')) {
      currentKind = 'check';
      result = job({ kind: 'check' });
    } else if (path === `${base}/jobs/job-1` && method === 'GET') {
      if (currentKind === 'check') {
        result = job({
          kind: 'check',
          status: 'completed',
          statusLabel: 'Finished',
          active: false,
          finding,
        });
      } else {
        backfillPolls++;
        if (backfillPolls >= 2 && !entries.some((e) => e.id === 'e-new'))
          entries.push(
            entry({
              id: 'e-new',
              title: 'Recovered promise',
              kind: 'debt',
              group: 'unfinished_business',
              overview: 'Return the cart.',
              text: 'Return the cart.',
              evidence: [],
            })
          );
        result =
          backfillPolls >= 2
            ? job({
                status: 'completed',
                statusLabel: 'Finished',
                active: false,
                progress: { processedPairs: 4, eligiblePairs: 4, created: 1, skipped: 0 },
              })
            : job({ progress: { processedPairs: 2, eligiblePairs: 4, created: 1, skipped: 0 } });
      }
    } else if (path.endsWith('/accept')) {
      const mira = entries.find((e) => e.id === 'e-mira')!;
      mira.text = mira.overview = 'Mira is a sister of the temple.';
      result = { decision: 'accepted', entry: mira };
    } else result = [campaign];
    requests.push({
      method,
      path: `${path}${url.search}`,
      body: request.postData() ?? '',
      response: JSON.stringify(result ?? null),
    });
    await json(result);
  });
  return { requests };
}

test('knowledge sits below unsaved notes, filters without losing them and links to old conversations', async ({
  page,
  context,
}) => {
  await mockApi(page);
  await page.goto(`/campaigns/${campaign.id}?tab=journal`);
  const notes = page.getByRole('textbox').first();
  await notes.fill('my unsaved draft');
  await expect(page.getByRole('heading', { name: 'Mira', level: 5 })).toBeVisible();
  // Placement: notes, then knowledge, then campaign memory.
  const order = await page.evaluate(() => {
    const knowledge = document.querySelector('.journal-knowledge')!;
    const textarea = document.querySelector('textarea')!;
    const memory = [...document.querySelectorAll('h3')].find(
      (h) => h.textContent === 'Campaign memory'
    )!;
    const before = (a: Element, b: Element) =>
      !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    return [before(textarea, knowledge), before(knowledge, memory)];
  });
  expect(order).toEqual([true, true]);
  await expect(page.getByRole('region', { name: 'People and places' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Unfinished business' })).toBeVisible();
  await expect(page.getByText('Returned the healer book.')).toBeHidden();
  await page.getByLabel('Show completed/past items').check();
  await expect(page.getByText('Returned the healer book.')).toBeVisible();
  await page.getByLabel('Search knowledge').fill('merchant');
  await expect(page.getByRole('heading', { name: 'Missing merchant', level: 5 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mira', level: 5 })).toBeHidden();
  await page.getByLabel('Search knowledge').fill('nothing matches this');
  await expect(page.getByText('No matching knowledge found.')).toBeVisible();
  await page.getByLabel('Search knowledge').fill('');
  await expect(notes).toHaveValue('my unsaved draft');

  await page.getByRole('button', { name: 'Details for Mira' }).click();
  await page.getByRole('button', { name: 'Campaign notes (version 1)' }).click();
  await expect(page.locator('.journal-quote')).toHaveText('Mira keeps the ledger.');
  const link = page.getByRole('link', { name: 'Conversation', exact: true });
  await expect(link).toHaveAttribute('href', `/campaigns/${campaign.id}?tab=play&turn=${OLD_TURN}`);
  // Modified clicks keep normal browser behaviour.
  const popup = context.waitForEvent('page');
  await link.click({ modifiers: ['Control'] });
  expect((await popup).url()).toContain(`turn=${OLD_TURN}`);
  await link.click();
  await expect(page.getByRole('heading', { name: 'Referenced conversation' })).toBeFocused();
  await expect(page.getByText('Mira says she is a sister of the temple.')).toBeVisible();
});

test('journal knowledge fits a 360px phone with 44px controls and no horizontal scrolling', async ({
  page,
}) => {
  await mockApi(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/campaigns/${campaign.id}?tab=journal&entry=e-mira`);
  await expect(page.getByRole('heading', { name: 'Mira', level: 5 })).toBeVisible();
  await page.getByRole('button', { name: 'Flag a mistake' }).click();
  await page.locator('details.journal-fill > summary').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  const heights = await page
    .locator('.journal-knowledge button')
    .evaluateAll((nodes) =>
      nodes
        .filter((n) => (n as HTMLElement).offsetParent !== null)
        .map((n) => n.getBoundingClientRect().height)
    );
  expect(heights.length).toBeGreaterThan(2);
  for (const height of heights) expect(height).toBeGreaterThanOrEqual(43.5);
  await page.getByLabel('Search knowledge').focus();
  await expect(page.getByLabel('Search knowledge')).toBeFocused();
});

test('backfill and correction flows run without gameplay writes or hidden text', async ({
  page,
}) => {
  const { requests } = await mockApi(page);
  await page.goto(`/campaigns/${campaign.id}?tab=journal`);
  await page.getByRole('textbox').first().fill('keep this draft');
  await page.locator('details.journal-fill > summary').click();
  await expect(page.getByText(/uses your provider allowance/)).toBeVisible();
  await page.getByRole('button', { name: 'Fill from past conversations' }).click();
  await expect(page.getByText(/Working: 0 of 4 conversations checked/)).toBeVisible();
  await expect(page.getByText(/Finished: 1 added, 0 skipped\./)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'Recovered promise', level: 5 })).toBeVisible();
  await expect(page.getByRole('textbox').first()).toHaveValue('keep this draft');

  await page.getByRole('button', { name: 'Details for Mira' }).click();
  await page.getByRole('button', { name: 'Flag a mistake' }).click();
  await page.getByLabel('What looks wrong?').fill('She is a sister, not an innkeeper.');
  await page.getByRole('button', { name: 'Check this fact' }).click();
  const finding = page.getByRole('region', { name: 'Finding' });
  await expect(finding.getByText('Correction proposed')).toBeVisible({ timeout: 10_000 });
  await expect(finding.getByText('Mira is a sister of the temple.')).toBeVisible();
  await expect(finding.locator('blockquote')).toContainText('a sister of the temple');
  // Nothing mutates before acceptance.
  expect(requests.some((r) => r.path.endsWith('/accept'))).toBe(false);
  await finding.getByRole('button', { name: 'Accept correction' }).click();
  await expect(page.getByText('Correction accepted.')).toBeVisible();
  await expect(page.getByLabel('What looks wrong?')).toHaveValue(
    'She is a sister, not an innkeeper.'
  );

  expect(requests.some((r) => r.method === 'POST' && /\/turns(\/|$)/.test(r.path))).toBe(false);
  expect(
    requests.some((r) => r.method === 'POST' && /\/(dice|combat|characters)/.test(r.path))
  ).toBe(false);
  for (const r of requests) expect(`${r.body}${r.response}`).not.toMatch(/SECRET|gm_only/);
});
