import { test, expect } from '@playwright/test';
import { fixtureCampaign, options, providers } from '../fixtures';

test('item sorting and modal editing work on desktop and mobile', async ({ page }) => {
  let campaign = fixtureCampaign();
  campaign.characters = [
    {
      ...campaign.characters[0],
      type: 'player',
      inventory: {
        sword: { name: 'Sword', type: 'weapon', damage: 10 },
        axe: { name: 'Axe', type: 'weapon', damage: 2 },
      },
    },
  ];
  const patches: unknown[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path === '/api/settings') data = options;
    else if (path === '/api/providers') data = providers;
    else if (route.request().method() === 'PATCH' && path.includes('/characters/')) {
      const patch = route.request().postDataJSON();
      patches.push(patch);
      campaign = {
        ...campaign,
        revision: campaign.revision + 1,
        characters: [{ ...campaign.characters[0], inventory: patch.inventory }],
      };
      data = campaign;
    } else if (path === `/api/campaigns/${campaign.id}`) data = campaign;
    await route.fulfill({ json: { data } });
  });
  await page.goto(`/campaigns/${campaign.id}`);
  await page.getByRole('button', { name: 'Characters', exact: true }).click();
  await page.getByRole('button', { name: 'Inventory', exact: true }).click();
  for (const label of ['Sort items by', 'Sort direction']) {
    const contrast = await page.getByLabel(label).evaluate((element) => {
      const style = getComputedStyle(element);
      const luminance = (color: string) => {
        const channels = color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((channel) => {
            const value = channel / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const text = luminance(style.color);
      const background = luminance(style.backgroundColor);
      return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
    });
    expect(
      contrast,
      `${label} text must be readable, including when disabled`
    ).toBeGreaterThanOrEqual(4.5);
  }
  await page.getByLabel('Sort items by').selectOption('damage');
  await expect(page.locator('.sheet-item:visible strong')).toHaveText(['Axe', 'Sword']);
  await page.getByRole('button', { name: 'Edit Axe', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Edit Axe' });
  await expect(modal).toBeVisible();
  await modal.getByLabel('damage').fill('12');
  await modal.getByRole('button', { name: 'Save item' }).click();
  await expect(modal.getByRole('status')).toHaveText('Item saved.');
  expect(patches).toEqual([
    {
      revision: 1,
      inventory: {
        sword: { name: 'Sword', type: 'weapon', damage: 10 },
        axe: { name: 'Axe', type: 'weapon', damage: 12 },
      },
    },
  ]);
  await modal.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('button', { name: 'Edit Axe', exact: true })).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Edit Sword', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete Axe', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Delete Axe' });
  await expect(confirmation.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await confirmation.getByRole('button', { name: 'Cancel' }).click();
  expect(patches).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Delete Axe', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Delete Axe', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Delete item', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.sheet-item:visible strong')).toHaveText(['Sword']);
  expect(patches[1]).toEqual({
    revision: 2,
    inventory: { sword: { name: 'Sword', type: 'weapon', damage: 10 } },
  });
  await page.getByRole('button', { name: 'Delete Sword', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete item', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page
      .getByRole('region', { name: `${campaign.characters[0].name} Inventory` })
      .getByText('Nothing recorded.')
  ).toBeVisible();
  expect(patches[2]).toEqual({ revision: 3, inventory: {} });
});
