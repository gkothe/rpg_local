import { test, expect } from '@playwright/test';
import { fixtureCampaign, options, providers } from '../fixtures';
test('phone pairs, keeps its draft through revocation/reconnect and uses relative API', async ({
  page,
}) => {
  const campaign = fixtureCampaign();
  let paired = false,
    expired = false;
  const apiOrigins = new Set<string>();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    apiOrigins.add(url.origin);
    const path = url.pathname;
    let data: unknown;
    if (path === '/api/lan/status')
      data = {
        enabled: true,
        desktop: false,
        paired,
        expiresAt: paired ? new Date(Date.now() + 3600000).toISOString() : null,
        connectUrls: [],
        microphoneRequiresHttps: true,
      };
    else if (path === '/api/lan/pair') {
      expect(route.request().headers()['x-rpg-client']).toBe('local-rpg');
      expect(route.request().postDataJSON()).toEqual({ code: 'A1B2C3D4' });
      paired = true;
      expired = false;
      data = { paired: true };
    } else if (path === '/api/settings') data = options;
    else if (!paired || expired)
      return route.fulfill({
        status: 403,
        json: {
          detail: 'Approve this phone using a desktop connection code',
          code: 'pairing_required',
        },
      });
    else if (path === '/api/providers') data = providers;
    else if (path === `/api/campaigns/${campaign.id}`) data = campaign;
    else data = [];
    await route.fulfill({ json: { data } });
  });
  await page.goto(`/campaigns/${campaign.id}`);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Desktop connection code')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.locator('[inert]').count()).toBe(1);
  await page.getByLabel('Desktop connection code').fill('a1b2c3d4');
  await page.getByRole('button', { name: 'Connect device', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('heading', { name: campaign.name })).toBeVisible();
  await page.getByLabel('Your action').fill('Keep this phone draft');
  expired = true;
  await page.getByRole('button', { name: 'Load full saved transcript' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Desktop connection code').fill('A1B2C3D4');
  await page.getByRole('button', { name: 'Connect device', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByLabel('Your action')).toHaveValue('Keep this phone draft');
  expect([...apiOrigins]).toEqual([new URL(page.url()).origin]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
});
test('desktop creates a short-lived single-use code and revokes devices', async ({ page }) => {
  let created = false,
    revoked = false;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown;
    if (path === '/api/lan/status')
      data = {
        enabled: true,
        desktop: true,
        paired: true,
        expiresAt: null,
        connectUrls: ['https://192.168.1.20:4100'],
        microphoneRequiresHttps: true,
      };
    else if (path === '/api/lan/code') {
      created = true;
      data = { code: 'A1B2C3D4', expiresAt: new Date(Date.now() + 120000).toISOString() };
    } else if (path === '/api/lan/revoke') {
      revoked = true;
      data = { revoked: true };
    } else if (path === '/api/settings') data = { ...options, lan: { enabled: true } };
    else if (path === '/api/providers') data = providers;
    else data = [];
    await route.fulfill({ json: { data } });
  });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Create connection code' }).click();
  await expect(page.getByLabel('Connection code', { exact: true })).toHaveText('A1B2C3D4');
  await expect(page.getByRole('link', { name: 'https://192.168.1.20:4100' })).toHaveAttribute(
    'href',
    'https://192.168.1.20:4100'
  );
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Revoke all devices' }).click();
  await expect(
    page.getByText('All device connections revoked. Devices must pair again.')
  ).toBeVisible();
  expect(created && revoked).toBe(true);
});
