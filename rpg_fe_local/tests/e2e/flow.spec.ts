import { test, expect } from '@playwright/test';

test('Flow explains off-prompt NPC retrieval using synthetic data only', async ({ page }) => {
  const calls: string[] = [];
  await page.route('**/api/**', (route) => {
    calls.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: { data: { enabled: false, desktop: true, paired: true } } });
  });
  await page.goto('/flow?view=tools');
  await page.getByRole('button', { name: /^campaign_npcs_get/ }).click();
  await expect(page.getByRole('heading', { name: 'How NPC lookup works' })).toBeVisible();
  await expect(
    page.getByText('The roster stays fixed for this turn and its retries.', { exact: false })
  ).toBeVisible();
  await page.getByText('Example arguments and result sent to the model', { exact: true }).click();
  await expect(page.locator('.flow-card pre').filter({ hasText: 'knowledgeLinks' })).toContainText(
    'Ivo'
  );
  expect(calls.every((path) => path === '/api/lan/status')).toBe(true);
});

test('explores the complete guide without campaign or provider requests', async ({
  page,
}, testInfo) => {
  const calls: string[] = [];
  await page.route('**/api/**', (route) => {
    calls.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.fulfill({ json: { data: { enabled: false, desktop: true, paired: true } } });
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/flow?node=context&step=prepare');
  await expect(page.getByRole('heading', { name: 'Follow the Flow' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Flow', exact: true })).toHaveAttribute(
    'aria-current',
    'page'
  );
  await page.getByRole('button', { name: /Send prompt/ }).click();
  await expect(page.getByRole('complementary')).toContainText(
    'Context builder → Provider CLI or API / LLM'
  );
  await page.reload();
  await expect(page.getByRole('complementary')).toContainText('Send prompt');
  await page.getByRole('button', { name: /PostgreSQL/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('complementary')).toContainText('PostgreSQL');
  await page.goBack();
  await expect(page.getByRole('complementary')).toContainText('Send prompt');
  await page.goForward();
  await expect(page.getByRole('complementary')).toContainText('PostgreSQL');
  await page.screenshot({ path: testInfo.outputPath('journey-desktop.png'), fullPage: true });
  await page.getByRole('link', { name: /^Payload/ }).click();
  await page.getByLabel('Mention Ivo in the action').check();
  await expect(page.getByText('Ivo included', { exact: true })).toBeVisible();
  await page.getByLabel('Simulate stale prior value').check();
  await expect(page.getByRole('status')).toContainText('Rejected');
  await page.getByRole('link', { name: /^Tools/ }).click();
  await page.getByLabel('Enable book tools').check();
  await page.getByRole('button', { name: /rules_get Book mode/ }).click();
  await page.getByText('Example arguments and result sent to the model').click();
  await expect(page.getByRole('heading', { name: 'Final ruleCitations entry' })).toBeVisible();
  await page.getByRole('link', { name: /^Storage/ }).click();
  await page.getByRole('combobox', { name: 'Outcome', exact: true }).selectOption('undo');
  await page.getByLabel('Later edit changed a touched field').check();
  await expect(page.getByRole('status')).toContainText('Undo blocked');
  await page.getByText('Source code and documentation', { exact: true }).click();
  await page.getByRole('button', { name: 'Read document section 3.1' }).click();
  await expect(page.getByLabel('Architecture document')).toContainText('PostgreSQL');
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every((call) => call === 'GET /api/lan/status')).toBe(true);
});

for (const width of [360, 768, 1440]) {
  test(`readable Flow and cold global navigation at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('**/api/**', (route) =>
      route.fulfill({
        json: {
          data:
            new URL(route.request().url()).pathname === '/api/lan/status'
              ? { enabled: false, desktop: true, paired: true }
              : [],
        },
      })
    );
    await page.goto('/rules');
    await expect(page.getByRole('link', { name: 'Flow', exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    await page.getByRole('link', { name: 'Flow', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Follow the Flow' })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`journey-${width}.png`), fullPage: true });
    if (width <= 900) {
      await page.getByRole('button', { name: /PostgreSQL/ }).click();
      await expect(
        page.getByRole('complementary').getByRole('heading', { name: 'PostgreSQL' })
      ).toBeFocused();
      await page.getByRole('button', { name: 'Back to explorer ↑' }).click();
      await expect(page.getByRole('button', { name: /01 Browser/ })).toBeFocused();
    }
    for (const view of ['payload', 'tools', 'storage']) {
      await page.goto(`/flow?view=${view}`);
      await expect(page.getByRole('heading', { name: 'Follow the Flow' })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true);
      const buttons = await page
        .locator('.flow-page button:visible')
        .evaluateAll((elements) => elements.map((el) => el.getBoundingClientRect().height));
      expect(buttons.every((height) => height >= 44)).toBe(true);
    }
  });
}

test('Flow preserves the outer LAN pairing boundary', async ({ page }) => {
  await page.route('**/api/lan/status', (route) =>
    route.fulfill({ json: { data: { enabled: true, desktop: false, paired: false } } })
  );
  await page.goto('/flow');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Connect this device' })).toBeVisible();
  await expect(page.locator('[inert]')).toContainText('Follow the Flow');
});
