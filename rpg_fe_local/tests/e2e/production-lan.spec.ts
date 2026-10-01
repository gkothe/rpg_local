import { test, expect } from '@playwright/test';
test('real production NIC-origin device pairing, secure cookie, reload and revoke/reconnect', async ({
  browser,
}) => {
  test.skip(
    !process.env.LOCAL_RPG_LAN_BASE_URL,
    'Requires explicitly isolated production backend and approved NIC LAN URL.'
  );
  const desktopUrl = process.env.LOCAL_RPG_BASE_URL || 'http://127.0.0.1:4100',
    phoneUrl = process.env.LOCAL_RPG_LAN_BASE_URL!;
  const desktop = await browser.newContext({ baseURL: desktopUrl, ignoreHTTPSErrors: true }),
    phone = await browser.newContext({
      baseURL: phoneUrl,
      ignoreHTTPSErrors: true,
      viewport: { width: 375, height: 812 },
    });
  const desk = await desktop.newPage(),
    mobile = await phone.newPage();
  const name = `LAN smoke ${Date.now()}`;
  const apiOrigins = new Set<string>();
  mobile.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) apiOrigins.add(url.origin);
  });
  try {
    await desk.goto('/new');
    await desk.getByLabel('Campaign name').fill(name);
    await desk.getByRole('button', { name: 'Create campaign' }).click();
    await expect(desk.getByRole('heading', { name })).toBeVisible();
    const campaignPath = new URL(desk.url()).pathname;
    await desk.getByRole('link', { name: 'Settings', exact: true }).click();
    await desk.getByRole('button', { name: 'Create connection code' }).click();
    let code = await desk.getByLabel('Connection code', { exact: true }).textContent();
    await mobile.goto(campaignPath);
    await expect(mobile.getByRole('dialog')).toBeVisible();
    const status = await mobile.evaluate(async () => {
      const response = await fetch('/api/lan/status');
      return (await response.json()).data as {
        enabled: boolean;
        desktop: boolean;
        paired: boolean;
      };
    });
    expect(status).toMatchObject({ enabled: true, desktop: false, paired: false });
    await mobile.getByLabel('Desktop connection code').fill(code!);
    await mobile.getByRole('button', { name: 'Connect device', exact: true }).click();
    await expect(mobile.getByRole('dialog')).not.toBeVisible();
    await expect(mobile.getByRole('heading', { name })).toBeVisible();
    const cookie = (await phone.cookies()).find((cookie) => cookie.name === 'rpg-device');
    expect(cookie?.httpOnly).toBe(true);
    if (phoneUrl.startsWith('https:')) {
      expect(cookie?.secure).toBe(true);
      expect(await mobile.evaluate(() => window.isSecureContext)).toBe(true);
    }
    await mobile.getByLabel('Your action').fill('Preserve my unsent phone action');
    desk.once('dialog', (dialog) => dialog.accept());
    await desk.getByRole('button', { name: 'Revoke all devices' }).click();
    await expect(
      desk.getByText('All device connections revoked. Devices must pair again.')
    ).toBeVisible();
    await mobile.getByRole('button', { name: 'Load full saved transcript' }).click();
    await expect(mobile.getByRole('dialog')).toBeVisible();
    await desk.getByRole('button', { name: 'Create connection code' }).click();
    code = await desk.getByLabel('Connection code', { exact: true }).textContent();
    await mobile.getByLabel('Desktop connection code').fill(code!);
    await mobile.getByRole('button', { name: 'Connect device', exact: true }).click();
    await expect(mobile.getByRole('dialog')).not.toBeVisible();
    await expect(mobile.getByLabel('Your action')).toHaveValue('Preserve my unsent phone action');
    await mobile.getByRole('button', { name: 'Journal', exact: true }).click();
    await mobile.getByLabel('Personal notes').fill('Saved from a paired LAN browser.');
    await mobile.getByRole('button', { name: 'Save notes' }).click();
    await expect(mobile.getByText('Changes saved.', { exact: true })).toBeVisible();
    await mobile.reload();
    await mobile.getByRole('button', { name: 'Journal', exact: true }).click();
    await expect(mobile.getByLabel('Personal notes')).toHaveValue(
      'Saved from a paired LAN browser.'
    );
    expect([...apiOrigins]).toEqual([new URL(phoneUrl).origin]);
    await desk.getByRole('link', { name: 'Library', exact: true }).click();
    desk.once('dialog', (dialog) => dialog.accept());
    await desk.getByRole('button', { name: `Delete ${name}`, exact: true }).click();
    await expect(desk.getByRole('button', { name: `Delete ${name}`, exact: true })).toHaveCount(0);
  } finally {
    await phone.close();
    await desktop.close();
  }
});
