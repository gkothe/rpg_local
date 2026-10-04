import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { fixtureCampaign, fixtureTurn, options, providers } from '../fixtures';
test('saved literal citations and outdated audit remain visible after the current library changes', async ({
  page,
}) => {
  const captured = {
    systemId: '55555555-5555-4555-8555-555555555555',
    systemKey: 'original',
    systemName: 'Original synthetic rules',
    kind: 'library',
    revision: 1,
    contentHash: 'a'.repeat(64),
  };
  const campaign = {
    ...fixtureCampaign(),
    ruleSystemId: captured.systemId,
    turns: [
      {
        ...fixtureTurn(),
        ruleContext: captured,
        ruleCitations: [
          {
            receiptId: '66666666-6666-4666-8666-666666666666',
            path: 'core_rules.original.check',
            source: 'original',
            quote: '<script>Original literal 🐉 quotation</script>',
            start: 0,
            end: 45,
            systemId: captured.systemId,
            revision: 1,
            contentHash: captured.contentHash,
            precision: 'unknown',
            pdfPages: [],
            printedPages: [],
          },
        ],
      },
    ],
  };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown;
    if (path === '/api/settings') data = options;
    else if (path === '/api/providers') data = providers;
    else if (path === '/api/rule-systems')
      data = [{ ...captured, isDefault: false, selectable: true }];
    else if (path.endsWith('/rule-system'))
      data = { ...captured, revision: 2, contentHash: 'b'.repeat(64) };
    else if (path.endsWith('/rule-reads')) data = [];
    else data = campaign;
    await route.fulfill({ json: { data } });
  });
  await page.goto(`/campaigns/${campaign.id}`);
  await page.getByLabel('Show debug info').check();
  await page.getByLabel('Your action').fill('Keep citation composer draft');
  await page.getByText('Rule evidence · 1 citations').click();
  await expect(
    page.getByText('<script>Original literal 🐉 quotation</script>', { exact: true })
  ).toBeVisible();
  await expect(page.getByText(/current library differs/)).toBeVisible();
  await expect(page.locator('.rule-evidence script')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Browse current library' })).toHaveAttribute(
    'href',
    `/rules/${captured.systemId}`
  );
  await expect(page.getByLabel('Your action')).toHaveValue('Keep citation composer draft');
});
test('original private book import, instructions, latest selection and explicit unresolved default recovery', async ({
  page,
}) => {
  test.skip(!process.env.LOCAL_RPG_RULES_SMOKE, 'Requires the isolated rules PostgreSQL backend.');
  test.setTimeout(90000);
  const suffix = Date.now();
  const name = `Original rules ${suffix}`;
  await page.goto('/rules');
  await page.getByLabel('System name', { exact: true }).fill(name);
  await page.getByLabel('Stable system key', { exact: false }).fill(`original-${suffix}`);
  await page.getByRole('button', { name: 'Create rule system' }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  const systemId = page.url().split('/').at(-1)!;
  const markdown = Buffer.from(
    '<!-- column: core_rules | source: original -->\n<!-- node: check | pages: 1 | printed: 1 -->\n<!-- page 1 (printed 1) -->\n# Original check\nOriginal synthetic authority 🐉.\n'
  );
  const manifest = {
    format: 'rules-book',
    version: 1,
    markerFormatVersion: 1,
    source: { slug: 'original', title: 'Original synthetic book', pageCount: 1, pdfHash: null },
    converter: { id: 'original-fixture', version: '1' },
    coverage: { description: 'All original synthetic words', omissions: [] },
    columns: [
      {
        column: 'core_rules',
        file: 'core_rules.md',
        hash: createHash('sha256').update(markdown).digest('hex'),
      },
    ],
  };
  await page.getByLabel('Book package files').setInputFiles([
    {
      name: 'manifest.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(manifest)),
    },
    { name: 'core_rules.md', mimeType: 'text/markdown', buffer: markdown },
  ]);
  await page.getByRole('button', { name: 'Preview import' }).click();
  await expect(
    page.getByRole('heading', { name: 'Preview: Original synthetic book' })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Publish book' }).click();
  await expect(page.getByText(/Book published/)).toBeVisible();
  await page.getByLabel('GM instructions', { exact: true }).fill('Original saved instructions');
  await page.getByRole('button', { name: 'Save instructions' }).click();
  await expect(page.getByText('Instructions saved.')).toBeVisible();
  await expect(page.getByLabel('GM instructions', { exact: true })).toHaveValue(
    'Original saved instructions'
  );
  await page.goto('/new');
  await page.getByLabel('Campaign name').fill(`Original campaign ${suffix}`);
  await page.getByLabel('System rules', { exact: true }).selectOption(systemId);
  await page.getByRole('button', { name: 'Create campaign' }).click();
  await expect(page.getByRole('heading', { name: `Original campaign ${suffix}` })).toBeVisible();
  const campaignUrl = page.url();
  const campaignId = new URL(campaignUrl).pathname.split('/').at(-1)!;
  await page.getByRole('button', { name: 'Game master', exact: true }).click();
  await expect(page.getByLabel('System rules', { exact: true })).toHaveValue(systemId);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByLabel('Your action').fill('Preserved composer draft');
  await expect(page.getByRole('button', { name: 'Send action' })).toBeDisabled();
  const exportedResponse = await page.request.get(`/api/campaigns/${campaignId}/export`);
  expect(exportedResponse.ok()).toBeTruthy();
  const archive = (await exportedResponse.json()).data;
  expect(archive.version).toBe(3);
  expect(JSON.stringify(archive)).not.toContain('Original synthetic authority');
  archive.campaign.ruleReference.systemKey = `missing-${suffix}`;
  const importedResponse = await page.request.post('/api/campaigns/import', {
    data: { archive },
    headers: { 'X-RPG-Client': 'local-rpg' },
  });
  expect(importedResponse.ok()).toBeTruthy();
  const imported = (await importedResponse.json()).data;
  await page.goto(`/campaigns/${imported.id}`);
  await page.getByRole('button', { name: 'Game master', exact: true }).click();
  await expect(page.getByText(/This save references/)).toBeVisible();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByLabel('Your action').fill('Keep unresolved draft');
  const options = await page.request.get('/api/rule-systems');
  const defaultOption = (await options.json()).data.find(
    (option: { isDefault: boolean }) => option.isDefault
  );
  await page.getByRole('button', { name: 'Game master', exact: true }).click();
  await page.getByLabel('System rules', { exact: true }).selectOption(defaultOption.systemId);
  await expect(page.getByText(/Rule selection saved/)).toBeVisible();
  await expect(page.getByLabel('Your action')).toHaveValue('Keep unresolved draft');
  await expect(page.getByText(/This save references/)).toHaveCount(0);
});
