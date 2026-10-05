import { test, expect } from '@playwright/test';
import { fixtureCampaign, fixtureTurn, options, providers } from '../fixtures';

test('saved voice and speed survive reload and apply to GM playback', async ({ page }) => {
  const campaign = { ...fixtureCampaign(), turns: [fixtureTurn()] };
  await page.addInitScript(() => {
    const target = new EventTarget();
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => [
          { voiceURI: 'first', name: 'First local', lang: 'en-US', localService: true },
          { voiceURI: 'chosen', name: 'Chosen local', lang: 'en-US', localService: true },
          { voiceURI: 'remote', name: 'Online voice', lang: 'en-US', localService: false },
        ],
        addEventListener: target.addEventListener.bind(target),
        removeEventListener: target.removeEventListener.bind(target),
        cancel() {},
        pause() {},
        resume() {},
        speak(utterance: SpeechSynthesisUtterance) {
          document.body.dataset.playedVoice = utterance.voice?.voiceURI;
          document.body.dataset.playedRate = String(utterance.rate);
        },
      },
    });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: class {
        constructor(public text: string) {}
      },
    });
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data =
      path === '/api/settings'
        ? options
        : path === '/api/providers'
          ? providers
          : path === `/api/campaigns/${campaign.id}`
            ? campaign
            : path === '/api/lan/status'
              ? { enabled: false, desktop: true, paired: true, expiresAt: null, connectUrls: [] }
              : [];
    await route.fulfill({ json: { data } });
  });
  await page.goto('/settings');
  await expect(
    page.getByRole('combobox', { name: 'Voice', exact: true }).getByText('Online voice')
  ).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Voice', exact: true }).selectOption('chosen');
  await page.getByRole('combobox', { name: 'Speed', exact: true }).selectOption('1.5');
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Voice', exact: true })).toHaveValue('chosen');
  await expect(page.getByRole('combobox', { name: 'Speed', exact: true })).toHaveValue('1.5');
  await page.goto(`/campaigns/${campaign.id}`);
  await expect(page.getByText('Read aloud', { exact: true })).toHaveCount(0);
  for (const name of ['Read', 'Pause', 'Stop']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('combobox', { name: 'Voice', exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Speed', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-played-voice', 'chosen');
  await expect(page.locator('body')).toHaveAttribute('data-played-rate', '1.5');
});
