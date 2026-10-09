import { test, expect } from '@playwright/test';
import { fixtureCampaign, options, providers } from '../fixtures';
const ATLAS_OPTIONS = {
  views: [
    { id: 'diagram', label: 'Diagram' },
    { id: 'floor_plan', label: 'Floor plan' },
  ],
  routeKinds: [{ id: 'door', label: 'Door' }],
  access: [
    { id: 'open', label: 'Open' },
    { id: 'locked', label: 'Locked' },
  ],
  units: [{ id: 'm', label: 'Metres' }],
  defaults: { visibility: 'player', certainty: 'established', origin: 'player' },
  images: { mimeTypes: ['image/png', 'image/jpeg'], maxPixels: 100000000 },
};

test('atlas navigates world/interior floors and stages travel without losing the composer', async ({
  page,
}) => {
  const campaign = fixtureCampaign();
  const site = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    office = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const place = (placeId: string, title: string) => ({
    placeId,
    title,
    text: 'Saved geography.',
    visited: false,
    certainty: 'established',
    expected: 'synthetic-token',
  });
  let submitted = 0;
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    if (path.endsWith('/turns') && route.request().method() === 'POST') submitted++;
    let data: unknown = [];
    if (path === '/api/settings') data = { ...options, atlas: ATLAS_OPTIONS };
    else if (path === '/api/providers') data = providers;
    else if (path === `/api/campaigns/${campaign.id}`) data = campaign;
    else if (path.endsWith('/atlas'))
      data = {
        scope: url.searchParams.get('scope') === 'world' ? null : site,
        position: office,
        breadcrumb: [{ id: site, title: 'Warehouse' }],
        places: [
          place(site, 'Warehouse'),
          {
            ...place(office, 'Office'),
            parentPlaceId: site,
            placement: { frameId: 'ground', x: 10, y: 10, width: 30, height: 20 },
          },
        ],
        routes: [
          {
            id: 'door',
            from: site,
            to: office,
            bidirectional: false,
            kind: 'door',
            access: 'locked',
            visibility: 'player',
            certainty: 'rumor',
            expected: 'synthetic-token',
          },
        ],
        frames: [
          {
            id: 'ground',
            placeId: site,
            label: 'Warehouse ground',
            floor: 'Ground',
            width: 100,
            height: 100,
            visibility: 'player',
            expected: 'synthetic-token',
          },
          {
            id: 'upper',
            placeId: site,
            label: 'Warehouse upper',
            floor: 'Upper',
            width: 100,
            height: 100,
            visibility: 'player',
            expected: 'synthetic-token',
          },
        ],
        nextCursor: null,
        nextRouteCursor: null,
      };
    await route.fulfill({ json: { data } });
  });
  await page.goto(`/campaigns/${campaign.id}`);
  await page.getByLabel('Your action').fill('I keep my lantern covered.');
  await page.getByRole('button', { name: 'Atlas', exact: true }).click();
  await expect(page.getByText('Current position: Office')).toBeVisible();
  await expect(page.getByText(/distance unknown.*travel time unknown/)).toBeVisible();
  await page.getByRole('button', { name: 'World view' }).click();
  await expect(page.getByRole('heading', { name: 'Campaign atlas' })).toBeVisible();
  await page.getByRole('button', { name: 'Floor plan', exact: true }).click();
  await expect(page.getByText(/not to scale/i)).toBeVisible();
  await page.getByLabel('Displayed floor').selectOption('upper');
  await page.getByRole('button', { name: 'Connected diagram', exact: true }).click();
  await page.getByRole('button', { name: 'Office', exact: true }).first().click();
  await page.getByRole('button', { name: 'Prepare travel action' }).click();
  await expect(page.getByLabel('Your action')).toHaveValue(
    'I keep my lantern covered.\nI try to travel to Office, using a known route if one is available.'
  );
  expect(submitted).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Atlas', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Campaign atlas' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
});
