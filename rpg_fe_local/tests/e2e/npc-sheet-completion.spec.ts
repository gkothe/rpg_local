import { test, expect } from '@playwright/test';
import { fixtureCampaign, options, providers } from '../fixtures';
import type { NpcSheetCompletionView } from '../../src/services/types';
test('NPC completion review survives reload and Apply preserves notes on a phone layout', async ({
  page,
}) => {
  const campaign = fixtureCampaign();
  let job: NpcSheetCompletionView | null = null;
  let mutations = 0;
  const base = `/api/campaigns/${campaign.id}/characters/${campaign.characters[0]!.id}/sheet-completions`;
  await page.route('**/api/**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    let data: unknown = [];
    if (path === '/api/settings') data = options;
    else if (path === '/api/providers') data = providers;
    else if (path === '/api/campaigns') data = [campaign];
    else if (path === `/api/campaigns/${campaign.id}`) data = campaign;
    else if (path.endsWith('/sheet-layout')) data = { fields: [] };
    else if (path === base) {
      if (req.method() === 'POST')
        job = {
          id: 'job',
          status: 'ready',
          active: false,
          canStart: false,
          error: null,
          basis: 'model_knowledge',
          systemName: 'Synthetic skill game',
          conflicts: [],
          additions: [{ path: ['attributes', 'skills', 'Lore'], value: 2 }],
          actions: [
            { id: 'apply', label: 'Apply', decision: true },
            { id: 'discard', label: 'Discard', decision: true },
          ],
        };
      data = job;
    } else if (path === `${base}/job/decisions`) {
      mutations++;
      campaign.characters[0]!.attributes = { health: 12, skills: { Lore: 2 } };
      job = { ...job!, status: 'applied', canStart: true, actions: [] };
      data = job;
    }
    await route.fulfill({ status: 200, json: { data } });
  });
  await page.goto(`/campaigns/${campaign.id}?tab=npcs`);
  await page.getByRole('button', { name: 'Marta', exact: true }).click();
  await page.getByLabel('Character notes').fill('Unsaved note');
  await page.getByRole('button', { name: 'Complete sheet', exact: true }).click();
  await expect(page.getByText('attributes → skills → Lore')).toBeVisible();
  await expect(page.getByLabel('Character notes')).toHaveValue('Unsaved note');
  expect(mutations).toBe(0);
  await page.reload();
  await page.getByRole('button', { name: 'Marta', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  await page.getByLabel('Character notes').fill('Keep this draft');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Complete sheet', exact: true })).toBeVisible();
  await expect(page.getByLabel('Character notes')).toHaveValue('Keep this draft');
  expect(mutations).toBe(1);
  expect(campaign.characters[0]!.notes).toBe('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
});
