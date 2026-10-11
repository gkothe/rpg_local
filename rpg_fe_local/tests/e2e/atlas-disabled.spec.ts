import { test, expect } from '@playwright/test';
import { fixtureCampaign, options, providers } from '../fixtures';

test('disabled Atlas hides navigation and redirects deep links to the player transcript', async ({
  page,
}) => {
  const campaign = fixtureCampaign();
  let atlasRequests = 0;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.includes('/atlas')) atlasRequests += 1;
    const data =
      path === '/api/settings'
        ? options
        : path === '/api/providers'
          ? providers
          : path === `/api/campaigns/${campaign.id}`
            ? campaign
            : [];
    await route.fulfill({ json: { data } });
  });
  await page.goto(`/campaigns/${campaign.id}?tab=atlas`);
  await expect(page.getByRole('heading', { name: campaign.name, exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Campaign transcript' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Atlas', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Characters', exact: true }).click();
  await page.goto(`/campaigns/${campaign.id}?tab=atlas`);
  await expect(page.getByRole('region', { name: 'Campaign transcript' })).toBeVisible();
  expect(atlasRequests).toBe(0);
});
