import { test, expect } from '@playwright/test';
import { fixtureCampaign, fixtureTurn, options, providers } from '../fixtures';
test('installed browser local voice reads existing GM text to completion', async ({ page }) => {
  test.skip(
    !process.env.LOCAL_RPG_VOICE_SMOKE,
    'Explicit installed-voice validation; speaks a short synthetic sentence.'
  );
  const campaign = {
    ...fixtureCampaign(),
    turns: [{ ...fixtureTurn(), narrative: 'The road is quiet.' }],
  };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data =
      path === '/api/lan/status'
        ? { enabled: false, desktop: true, paired: true, expiresAt: null, connectUrls: [] }
        : path === '/api/settings'
          ? options
          : path === '/api/providers'
            ? providers
            : path === `/api/campaigns/${campaign.id}`
              ? campaign
              : [];
    await route.fulfill({ json: { data } });
  });
  await page.goto(`/campaigns/${campaign.id}`);
  await page.getByText('Read aloud', { exact: true }).click();
  await expect
    .poll(
      () =>
        page.evaluate(
          () => window.speechSynthesis.getVoices().filter((v) => v.localService).length
        ),
      { timeout: 15000 }
    )
    .toBeGreaterThan(0);
  await page.evaluate(() => {
    const state = window as unknown as {
      rpgVoiceResult: { status: string; voice: string; local: boolean; error?: string };
    };
    state.rpgVoiceResult = { status: 'waiting', voice: '', local: false };
    const original = window.speechSynthesis.speak.bind(window.speechSynthesis);
    window.speechSynthesis.speak = (utterance) => {
      state.rpgVoiceResult = {
        status: 'started',
        voice: utterance.voice?.name || '',
        local: !!utterance.voice?.localService,
      };
      utterance.addEventListener('end', () => (state.rpgVoiceResult.status = 'ended'));
      utterance.addEventListener('error', (e) => {
        state.rpgVoiceResult.status = 'error';
        state.rpgVoiceResult.error = e.error;
      });
      original(utterance);
    };
  });
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await page.waitForFunction(
    () =>
      ['ended', 'error'].includes(
        (window as unknown as { rpgVoiceResult: { status: string } }).rpgVoiceResult.status
      ),
    {},
    { timeout: 30000 }
  );
  const result = await page.evaluate(
    () =>
      (
        window as unknown as {
          rpgVoiceResult: { status: string; voice: string; local: boolean; error?: string };
        }
      ).rpgVoiceResult
  );
  console.log('Installed local voice result:', JSON.stringify(result));
  expect(result.local).toBe(true);
  expect(result.status, result.error).toBe('ended');
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeDisabled();
});
