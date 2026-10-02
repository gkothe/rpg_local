import { test, expect } from '@playwright/test';
import { fixtureCampaign, options, providers } from '../fixtures';

test('setup imports separate campaign documents and character sheet before source review', async ({
  page,
}) => {
  let campaign = fixtureCampaign();
  const imports: string[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path === '/api/settings') data = options;
    else if (path === '/api/providers')
      data = providers.map((provider) => ({
        ...provider,
        compatibilityWarning:
          'Untested CLI version. Gameplay is allowed; failed turns show an error.',
      }));
    else if (path === '/api/campaigns' || path === `/api/campaigns/${campaign.id}`) data = campaign;
    else if (path.endsWith('/sources/extract')) {
      const body = route.request().postDataBuffer()!.toString();
      expect(body).toContain(`name="revision"\r\n\r\n${campaign.revision}`);
      const name = /filename="([^"]+)"/.exec(body)![1];
      imports.push(name);
      campaign = {
        ...campaign,
        revision: campaign.revision + 1,
        sources: [
          ...campaign.sources,
          {
            id: `source-${imports.length}`,
            name,
            kind: 'text',
            text: 'Review this imported text.',
            status: 'confirmed',
            version: 1,
            pages: [],
            warnings: [],
          },
        ],
      };
      data = campaign;
    }
    await route.fulfill({ json: { data } });
  });
  await page.goto('/new');
  await page.getByLabel('Campaign name').fill('Vampire');
  await page.getByLabel('AI CLI').selectOption(providers[0]!.id);
  await expect(page.getByRole('status')).toContainText('Untested CLI version. Gameplay is allowed');
  await page.getByLabel('Campaign files (select multiple)').setInputFiles([
    { name: 'adventure.md', mimeType: 'text/markdown', buffer: Buffer.from('Adventure') },
    { name: 'setting.txt', mimeType: 'text/plain', buffer: Buffer.from('Setting') },
  ]);
  await page.getByLabel('Character sheet file').setInputFiles({
    name: 'character.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('Character'),
  });
  expect(imports).toEqual([]);
  await page.getByRole('button', { name: 'Create campaign' }).click();
  await expect(page.getByRole('heading', { name: 'Rules & source material' })).toBeVisible();
  expect(imports).toEqual(['adventure.md', 'setting.txt', 'character.md']);
  for (const name of imports) await expect(page.locator('.source-row strong').getByText(name, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View / edit text' })).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Review text' })).toHaveCount(0);
});
