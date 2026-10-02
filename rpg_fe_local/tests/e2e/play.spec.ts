import { test, expect } from '@playwright/test';
import { fixtureCampaign, fixtureTurn, options, providers } from '../fixtures';
test('PDF source text can be optionally corrected after import', async ({
  page,
}) => {
  let campaign = fixtureCampaign();
  campaign.sources = [
    {
      id: 'pdf-source',
      name: 'Scanned rules',
      kind: 'pdf',
      text: 'The bridgc is closcd.',
      status: 'confirmed',
      version: 1,
      pages: [],
      warnings: ['OCR text needs review.'],
    },
  ];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown;
    if (path === '/api/settings') data = options;
    else if (path === '/api/providers') data = providers;
    else if (path.endsWith('/sources/pdf-source') && route.request().method() === 'PATCH') {
      expect(route.request().postDataJSON()).toEqual({
        revision: 1,
        text: 'The bridge is closed.',
        confirmed: true,
      });
      campaign = {
        ...campaign,
        revision: 2,
        sources: [
          {
            ...campaign.sources[0],
            text: 'The bridge is closed.',
            status: 'confirmed',
            version: 2,
          },
        ],
      };
      data = campaign;
    } else if (path === `/api/campaigns/${campaign.id}`) data = campaign;
    else data = [];
    await route.fulfill({ json: { data } });
  });
  await page.goto(`/campaigns/${campaign.id}`);
  await page.getByRole('button', { name: 'Sources', exact: true }).click();
  await expect(page.getByText('pdf · confirmed · version 1')).toBeVisible();
  await page.getByRole('button', { name: 'View / edit text' }).click();
  await expect(page.getByText('OCR text needs review.')).toBeVisible();
  await page.getByLabel('Extracted text').fill('The bridge is closed.');
  await page.getByRole('button', { name: 'Confirm corrected text' }).click();
  await expect(page.getByText('pdf · confirmed · version 2')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Review: Scanned rules' })).toHaveCount(0);
});
test('desktop play preserves typed drafts, commits changes and undoes the turn', async ({
  page,
}) => {
  let campaign = fixtureCampaign(),
    job = fixtureTurn();
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname,
      method = route.request().method();
    let data: unknown;
    if (path === '/api/settings') data = options;
    else if (path === '/api/providers') data = providers;
    else if (path === '/api/templates') data = [];
    else if (path === '/api/campaigns') data = [campaign];
    else if (path.endsWith('/undo')) {
      campaign = { ...campaign, revision: 3, turns: [{ ...job, undone: true }] };
      data = campaign;
    } else if (path.endsWith('/turns') && method === 'POST') {
      job = { ...job, action: route.request().postDataJSON().action, status: 'pending' };
      data = job;
    } else if (path.includes('/turns/')) {
      job = { ...job, status: 'completed' };
      campaign = { ...campaign, revision: 2, turns: [job] };
      data = job;
    } else if (path === `/api/campaigns/${campaign.id}`) data = campaign;
    else return route.fulfill({ status: 404, json: { detail: 'Unmocked test route' } });
    await route.fulfill({ json: { data } });
  });
  await page.goto(`/campaigns/${campaign.id}`);
  await expect(page.getByRole('heading', { name: 'The Northern Road' })).toBeVisible();
  await page.getByLabel('Your action').fill('Open the door');
  await page.getByRole('button', { name: 'Send action' }).click();
  await page.getByLabel('Your action').fill('Keep this unsent draft');
  await expect(page.getByText(job.narrative!)).toBeVisible();
  await expect(page.getByLabel('Your action')).toHaveValue('Keep this unsent draft');
  await page.getByText('1 state change', { exact: true }).click();
  await expect(page.getByText(job.changes[0])).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Undo last turn' }).click();
  await expect(page.getByText(job.narrative!)).toHaveCount(0);
  await expect(page.getByLabel('Your action')).toHaveValue('Keep this unsent draft');
});
test('setup submits only explicit campaign fields', async ({ page }) => {
  let created = false;
  const campaign = fixtureCampaign();
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown;
    if (path === '/api/providers') data = providers;
    else if (path === '/api/settings') data = options;
    else if (path === '/api/campaigns' && route.request().method() === 'POST') {
      expect(route.request().postDataJSON()).toMatchObject({
        name: 'Fresh campaign',
        description: '',
        settings: { provider: '', model: '', effort: null },
      });
      created = true;
      data = campaign;
    } else if (path === `/api/campaigns/${campaign.id}`) data = campaign;
    else data = [];
    await route.fulfill({ json: { data } });
  });
  await page.goto('/new');
  await page.getByLabel('Campaign name').fill('Fresh campaign');
  await page.getByRole('button', { name: 'Create campaign' }).click();
  await expect(page.getByRole('heading', { name: campaign.name })).toBeVisible();
  await expect(
    page.getByText('Campaign created. Imported documents are ready to use.', { exact: false })
  ).toBeVisible();
  await expect(page.getByLabel('Markdown, text or PDF files (select multiple)')).toBeVisible();
  await expect(page.getByLabel('Public Google Docs URL')).toBeVisible();
  expect(created).toBe(true);
});
test('journal layout has no horizontal overflow across standard widths', async ({ page }) => {
  const campaign = { ...fixtureCampaign(), turns: [fixtureTurn()] };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      json: {
        data:
          path === '/api/settings'
            ? options
            : path === '/api/providers'
              ? providers
              : path === '/api/templates'
                ? []
                : path === `/api/campaigns/${campaign.id}`
                  ? campaign
                  : [campaign],
      },
    });
  });
  await page.goto(`/campaigns/${campaign.id}`);
  await expect(page.getByText(fixtureTurn().narrative!)).toBeVisible();
  await expect(page.getByLabel('AI CLI')).toBeHidden();
  await page.getByRole('button', { name: 'Game master', exact: true }).click();
  await expect(page.getByLabel('AI CLI')).toBeVisible();
  await expect(page.getByLabel('System rules', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Your action')).toBeHidden();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByLabel('AI CLI')).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/journal-desktop.png', fullPage: true });
  for (const width of [320, 375, 768, 1024, 1280, 1440, 1920, 2560]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `overflow at ${width}px`
    ).toBe(true);
    await expect(page.getByRole('button', { name: 'Send action' })).toBeVisible();
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: 'test-results/journal-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Characters', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Marta npc' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
});
