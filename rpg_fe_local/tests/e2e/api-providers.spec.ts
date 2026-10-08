import { test, expect } from '@playwright/test';
import { fixtureCampaign, options, providers } from '../fixtures';

const apiModel = {
  id: 'gemini-test',
  label: 'gemini-test',
  efforts: [],
  inputTokens: 16000,
  dice: { supported: true, reason: null },
  rules: { supported: true, reason: null, efforts: [] },
};
const gemini = {
  ...providers[0]!,
  id: 'gemini-api',
  transport: 'api',
  name: 'Gemini API',
  version: null,
  models: [apiModel],
  dice: { supported: true, reason: null },
};
const openrouter = {
  ...gemini,
  id: 'openrouter',
  name: 'OpenRouter',
  available: false,
  supported: false,
  reason: 'Set OPENROUTER_API_KEY in the backend .env and restart the backend',
  models: [],
  dice: {
    supported: false,
    reason: 'Set OPENROUTER_API_KEY in the backend .env and restart the backend',
  },
};

test('an API provider is chosen beside the CLIs, saved without an effort and recovers from a failure', async ({
  page,
}) => {
  const campaign = fixtureCampaign();
  const created: unknown[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let data: unknown = [];
    if (path === '/api/settings') data = options;
    else if (path === '/api/providers') data = [...providers, gemini, openrouter];
    else if (path === '/api/campaigns' && request.method() === 'POST') {
      created.push(request.postDataJSON());
      if (created.length === 1) {
        await route.fulfill({
          status: 502,
          contentType: 'application/problem+json',
          json: {
            type: 'about:blank',
            title: 'Bad Gateway',
            status: 502,
            detail: 'Gemini API quota or rate limit reached',
            code: 'provider_quota',
          },
        });
        return;
      }
      data = campaign;
    } else if (path === `/api/campaigns/${campaign.id}`) data = campaign;
    await route.fulfill({ json: { data } });
  });
  await page.goto('/new');
  await page.getByLabel('Campaign name').fill('Cloud table');
  await expect(page.getByRole('option', { name: 'OpenRouter — not configured' })).toHaveAttribute(
    'disabled',
    ''
  );
  await expect(page.getByRole('option', { name: 'Claude Code' })).not.toHaveAttribute(
    'disabled',
    ''
  );
  await page.getByLabel('AI provider').selectOption('gemini-api');
  await expect(page.getByRole('status')).toContainText('Gemini API runs remotely');
  await expect(page.getByLabel('Effort')).toBeDisabled();
  await page.getByRole('button', { name: 'Create campaign' }).click();
  await expect(page.getByText('Gemini API quota or rate limit reached')).toBeVisible();
  await expect(page.getByLabel('Campaign name')).toHaveValue('Cloud table');
  await page.getByRole('button', { name: 'Create campaign' }).click();
  await expect(page.getByRole('heading', { name: campaign.name })).toBeVisible();
  expect(created).toHaveLength(2);
  for (const body of created)
    expect(body).toMatchObject({
      settings: { provider: 'gemini-api', model: 'gemini-test', effort: null },
    });
});
