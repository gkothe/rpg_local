import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const audio = process.env.LOCAL_RPG_FAKE_AUDIO_WAV;
test.use({
  permissions: ['microphone'],
  launchOptions: {
    ...(process.env.LOCAL_BROWSER_PATH ? { executablePath: process.env.LOCAL_BROWSER_PATH } : {}),
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      ...(audio ? [`--use-file-for-fake-audio-capture=${audio}`] : []),
    ],
  },
});
function waveDuration(path: string) {
  const data = readFileSync(path);
  let rate = 0,
    size = 0;
  for (let at = 12; at + 8 <= data.length;) {
    const kind = data.toString('ascii', at, at + 4),
      length = data.readUInt32LE(at + 4);
    if (kind === 'fmt ') rate = data.readUInt32LE(at + 16);
    if (kind === 'data') size = length;
    at += 8 + length + (length % 2);
  }
  if (!rate || !size) throw new Error('Use a generated PCM WAV fixture.');
  return (size / rate) * 1000;
}
test('actual fake microphone→local Whisper→editable text never auto-submits a GM turn', async ({
  page,
}) => {
  test.skip(
    !audio || !process.env.LOCAL_RPG_BASE_URL,
    'Requires isolated configured backend and synthetic WAV capture; real microphones are never used.'
  );
  test.setTimeout(60000);
  const name = `Dictation smoke ${Date.now()}`;
  let gmSubmissions = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/turns'))
      gmSubmissions++;
  });
  await page.goto('/new');
  await page.getByLabel('Campaign name').fill(name);
  await page.getByRole('button', { name: 'Create campaign' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dictate', exact: true })).toBeEnabled();
  const devices = await page.evaluate(async () =>
    (await navigator.mediaDevices.enumerateDevices())
      .filter((d) => d.kind === 'audioinput')
      .map((d) => d.label)
  );
  expect(devices.some((label) => /fake/i.test(label))).toBe(true);
  await page.getByRole('button', { name: 'Dictate', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible();
  await page.waitForTimeout(Math.ceil(waveDuration(audio!) + 500));
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await expect(page.getByLabel('Your action')).toHaveValue(
    /old tower.*healing potion.*12 health points/is,
    { timeout: 30000 }
  );
  expect(gmSubmissions).toBe(0);
  await page.getByLabel('Your action').fill('I approach the tower quietly.');
  await expect(page.getByLabel('Your action')).toHaveValue('I approach the tower quietly.');
  expect(gmSubmissions).toBe(0);
  await page.getByRole('link', { name: 'Back to library' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: `Delete ${name}`, exact: true }).click();
  await expect(page.getByRole('button', { name: `Delete ${name}`, exact: true })).toHaveCount(0);
});
