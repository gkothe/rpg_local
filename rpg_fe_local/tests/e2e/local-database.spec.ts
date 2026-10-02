import { test, expect } from '@playwright/test';
test('real isolated PostgreSQL manual campaign, source, notes and archive round trip', async ({
  page,
}) => {
  test.setTimeout(90000);
  test.skip(
    !process.env.LOCAL_RPG_LIVE_SMOKE,
    'Requires explicitly prepared isolated PostgreSQL backend on4100.'
  );
  const name = `Smoke verification ${Date.now()}`;
  await page.goto('/new');
  await page.getByLabel('Campaign name').fill(name);
  await page.getByRole('button', { name: 'Create campaign' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  const originalUrl = page.url();
  await page.getByRole('button', { name: 'Characters', exact: true }).click();
  await page.getByText('Add a character', { exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Smoke character');
  await page.getByRole('button', { name: 'Add character', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Smoke character player' })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept(`${name} character`));
  await page.getByRole('button', { name: 'Save character as template' }).click();
  await page.getByText('Reusable character templates', { exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Character template', exact: true })
    .selectOption({ label: `${name} character` });
  await page.getByRole('button', { name: 'Add character from template' }).click();
  await expect(page.getByRole('heading', { name: 'Smoke character player' })).toHaveCount(2);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: `Delete character template ${name} character` }).click();
  await expect(
    page.getByRole('button', { name: `Delete character template ${name} character` })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Sources', exact: true }).click();
  await page.getByRole('button', { name: 'Add source', exact: true }).click();
  await page.getByLabel('Source name').fill('Smoke rules');
  await page
    .getByLabel('Paste rules or source text')
    .fill('Always describe the scene before asking for an action.');
  await page.getByRole('button', { name: 'Add pasted text' }).click();
  await page.getByRole('button', { name: 'Back to sources' }).click();
  await page.getByRole('button', { name: 'View / edit text' }).click();
  await page.getByLabel('Extracted text').fill('Always describe the scene. The bridge is closed.');
  await page.getByRole('button', { name: 'Confirm corrected text' }).click();
  await expect(page.getByText(/confirmed.*version/)).toBeVisible();
  await page.getByRole('button', { name: 'Journal', exact: true }).click();
  await page.getByRole('button', { name: 'Reload current journal' }).click();
  await page.getByLabel('Personal notes').fill('Private smoke note');
  await page.getByRole('button', { name: 'Save notes' }).click();
  await expect(page.getByRole('status')).toHaveText('Changes saved.');
  await page.reload();
  await page.getByRole('button', { name: 'Journal', exact: true }).click();
  await expect(page.getByLabel('Personal notes')).toHaveValue('Private smoke note');
  page.once('dialog', (dialog) => dialog.accept(`${name} template`));
  await page.getByRole('button', { name: 'Save template' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  await page.getByRole('link', { name: 'Back to library' }).click();
  await expect(page.getByRole('heading', { name: 'Campaign library', exact: true })).toBeVisible();
  await page.locator('input[type=file]').setInputFiles(path!);
  await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name })).toBeVisible();
  expect(page.url()).not.toBe(originalUrl);
  await page.getByRole('button', { name: 'Journal', exact: true }).click();
  await expect(page.getByLabel('Personal notes')).toHaveValue('Private smoke note');
  await page.getByRole('button', { name: 'Characters', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Smoke character player' })).toHaveCount(2);
  await page.getByRole('link', { name: 'Back to library' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page
    .getByRole('button', { name: `Delete ${name}`, exact: true })
    .first()
    .click();
  await expect(page.getByRole('button', { name: `Delete ${name}`, exact: true })).toHaveCount(1);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: `Delete ${name}`, exact: true }).click();
  await expect(page.getByRole('button', { name: `Delete ${name}`, exact: true })).toHaveCount(0);
  page.once('dialog', (dialog) => dialog.accept());
  await page
    .getByRole('heading', { name: `${name} template` })
    .locator('..')
    .getByRole('button', { name: 'Delete template' })
    .click();
  await expect(page.getByRole('heading', { name: `${name} template` })).toHaveCount(0);
});
