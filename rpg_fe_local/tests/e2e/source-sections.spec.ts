import { test, expect } from '@playwright/test';
import { fixtureCampaign, options, providers } from '../fixtures';
test('pins a current source section instead of sending an entire rulebook', async ({ page }) => {
  let campaign = fixtureCampaign();
  campaign.sources = [
    {
      id: 'rules',
      name: 'Large rulebook',
      kind: 'pdf',
      text: 'Stealth rules. Combat rules.',
      status: 'confirmed',
      version: 2,
      pages: [{ page: 1, confidence: 94, text: 'Stealth rules. Combat rules.' }],
      warnings: [],
      originalAvailable: true,
    },
  ];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown;
    if (path === '/api/lan/status')
      data = { enabled: false, desktop: true, paired: true, expiresAt: null, connectUrls: [] };
    else if (path === '/api/settings') data = options;
    else if (path === '/api/providers') data = providers;
    else if (path.endsWith('/sections'))
      data = [
        {
          id: 'rules:2:0',
          index: 0,
          text: 'Stealth rules.',
          start: 0,
          end: 14,
          page: 1,
          version: 2,
          pinned: !!campaign.pinnedSourceSections?.length,
        },
      ];
    else if (path === `/api/campaigns/${campaign.id}` && route.request().method() === 'PATCH') {
      expect(route.request().postDataJSON()).toEqual({
        revision: 1,
        pinnedSourceSections: [{ sourceId: 'rules', version: 2, index: 0 }],
      });
      campaign = {
        ...campaign,
        revision: 2,
        pinnedSourceSections: [{ sourceId: 'rules', version: 2, index: 0 }],
      };
      data = campaign;
    } else if (path === `/api/campaigns/${campaign.id}`) data = campaign;
    else data = [];
    await route.fulfill({ json: { data } });
  });
  await page.goto(`/campaigns/${campaign.id}`);
  await page.getByRole('button', { name: 'Sources', exact: true }).click();
  await page.getByRole('button', { name: 'View / edit text' }).click();
  await expect(page.getByRole('link', { name: 'Open original document' })).toHaveAttribute(
    'href',
    `/api/campaigns/${campaign.id}/sources/rules/original`
  );
  await page.getByText('Original extraction pages & confidence').click();
  await expect(page.getByText('94', { exact: true })).toBeVisible();
  await page.getByText('Inspect & pin source sections').click();
  await page.getByRole('button', { name: 'Pin section', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unpin section' })).toBeVisible();
  await expect(page.getByText('Section pinned for future turns.')).toBeVisible();
});
