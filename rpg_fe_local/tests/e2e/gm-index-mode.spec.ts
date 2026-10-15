import { expect, test } from '@playwright/test';
import { fixtureCampaign, fixtureTurn, options, providers } from '../fixtures';
import type { Provider } from '../../src/services/types';

test('GM updater choice saves and survives reload, with unsupported providers disabled', async ({
  page,
}) => {
  const campaign = { ...fixtureCampaign(), turns: [fixtureTurn()] };
  let supported = true;
  const updateModes = [
    { id: 'separate_agent', label: 'Separate index agent', default: true },
    {
      id: 'same_gm_conversation',
      label: 'Continue the turn GM',
      default: false,
      requiresConversation: true,
    },
  ];
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const pathname = new URL(req.url()).pathname;
    let data: unknown = campaign;
    if (pathname === '/api/settings')
      data = {
        ...options,
        gmIndex: { purposeId: 'gm_index', modes: [], finalizationStages: [], updateModes },
      };
    else if (pathname === '/api/providers')
      data = providers.map((provider) => ({
        ...provider,
        gmConversation: {
          supported,
          reason: supported ? null : 'Synthetic provider has no continuing conversation.',
        },
      }));
    else if (pathname.endsWith('/rule-system'))
      data = { kind: 'model_knowledge', systemName: 'Synthetic', sheetLayout: { fields: [] } };
    else if (req.method() === 'PATCH') Object.assign(campaign, req.postDataJSON());
    await route.fulfill({ json: { data } });
  });
  await page.goto(`/campaigns/${campaign.id}?tab=game%20master`);
  const select = page.getByRole('combobox', { name: 'GM index updater' });
  await expect(select).toHaveValue('separate_agent');
  await select.selectOption('same_gm_conversation');
  await expect(
    page.getByText('GM index updater saved. Applies to the next indexed turn.')
  ).toBeVisible();
  await page.reload();
  await expect(select).toHaveValue('same_gm_conversation');
  supported = false;
  await page.reload();
  await expect(select.locator('option[value="same_gm_conversation"]')).toHaveJSProperty(
    'disabled',
    true
  );
  await expect(page.getByText('Synthetic provider has no continuing conversation.')).toBeVisible();
});

test('switching across all five providers enables/disables same-conversation mode and displays diagnostic reasons', async ({
  page,
}) => {
  const allProviders: Provider[] = [
    {
      id: 'claude',
      transport: 'cli',
      name: 'Claude Code',
      available: true,
      supported: true,
      reason: null,
      version: '1.0.0',
      models: [
        { id: 'claude-3-7-sonnet', label: 'Claude 3.7 Sonnet', efforts: [], inputTokens: 16000 },
      ],
      catalogProvenance: 'test',
      gmConversation: { supported: true, reason: null },
    },
    {
      id: 'codex',
      transport: 'cli',
      name: 'OpenAI Codex',
      available: true,
      supported: true,
      reason: null,
      version: '0.159.2',
      models: [{ id: 'gpt-5.6-sol', label: 'GPT 5.6', efforts: [], inputTokens: 8000 }],
      catalogProvenance: 'test',
      gmConversation: { supported: false, reason: 'Codex subscription login missing.' },
    },
    {
      id: 'agy',
      transport: 'cli',
      name: 'Antigravity',
      available: true,
      supported: true,
      reason: null,
      version: '1.2.14',
      models: [
        { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', efforts: [], inputTokens: 16000 },
      ],
      catalogProvenance: 'test',
      gmConversation: { supported: true, reason: null },
    },
    {
      id: 'gemini-api',
      transport: 'api',
      name: 'Gemini API',
      available: true,
      supported: true,
      reason: null,
      version: '1.0.0',
      models: [
        { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', efforts: [], inputTokens: 32000 },
      ],
      catalogProvenance: 'test',
      gmConversation: { supported: true, reason: null },
    },
    {
      id: 'openrouter',
      transport: 'api',
      name: 'OpenRouter',
      available: true,
      supported: true,
      reason: null,
      version: '1.0.0',
      models: [{ id: 'openrouter/auto', label: 'Auto', efforts: [], inputTokens: 8000 }],
      catalogProvenance: 'test',
      gmConversation: {
        supported: false,
        reason: 'OpenRouter free tier lacks conversation memory.',
      },
    },
  ];

  const updateModes = [
    { id: 'separate_agent', label: 'Separate index agent', default: true },
    {
      id: 'same_gm_conversation',
      label: 'Continue the turn GM',
      default: false,
      requiresConversation: true,
    },
  ];

  const campaign = {
    ...fixtureCampaign(),
    settings: { provider: 'claude', model: 'claude-3-7-sonnet', effort: null },
    gmIndexUpdateMode: 'same_gm_conversation',
    turns: [fixtureTurn()],
  };

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const pathname = new URL(req.url()).pathname;
    let data: unknown = campaign;
    if (pathname === '/api/settings')
      data = {
        ...options,
        gmIndex: { purposeId: 'gm_index', modes: [], finalizationStages: [], updateModes },
      };
    else if (pathname === '/api/providers') data = allProviders;
    else if (pathname.endsWith('/rule-system'))
      data = { kind: 'model_knowledge', systemName: 'Synthetic', sheetLayout: { fields: [] } };
    else if (req.method() === 'PATCH') {
      Object.assign(campaign, req.postDataJSON());
    }
    await route.fulfill({ json: { data } });
  });

  await page.goto(`/campaigns/${campaign.id}?tab=game%20master`);

  const updaterSelect = page.getByRole('combobox', { name: 'GM index updater' });
  const sameOption = updaterSelect.locator('option[value="same_gm_conversation"]');
  const providerSelect = page.getByRole('combobox', { name: 'AI provider' });

  // 1. Initially claude: supported, enabled, selected
  await expect(providerSelect).toHaveValue('claude');
  await expect(sameOption).toHaveJSProperty('disabled', false);
  await expect(updaterSelect).toHaveValue('same_gm_conversation');

  // 2. Switch to codex (unsupported): same_gm_conversation disabled, reason shown
  await providerSelect.selectOption('codex');
  await expect(providerSelect).toHaveValue('codex');
  await expect(sameOption).toHaveJSProperty('disabled', true);
  await expect(page.getByText('Codex subscription login missing.')).toBeVisible();

  // 3. Switch to agy (supported): same_gm_conversation enabled, reason cleared
  await providerSelect.selectOption('agy');
  await expect(providerSelect).toHaveValue('agy');
  await expect(sameOption).toHaveJSProperty('disabled', false);
  await expect(page.getByText('Codex subscription login missing.')).not.toBeVisible();

  // 4. Switch to gemini-api (supported): enabled
  await providerSelect.selectOption('gemini-api');
  await expect(providerSelect).toHaveValue('gemini-api');
  await expect(sameOption).toHaveJSProperty('disabled', false);

  // 5. Switch to openrouter (unsupported): disabled, diagnostic reason shown
  await providerSelect.selectOption('openrouter');
  await expect(providerSelect).toHaveValue('openrouter');
  await expect(sameOption).toHaveJSProperty('disabled', true);
  await expect(page.getByText('OpenRouter free tier lacks conversation memory.')).toBeVisible();

  // 6. Reload on unsupported provider: openrouter persists, reason still shown
  await page.reload();
  await expect(providerSelect).toHaveValue('openrouter');
  await expect(sameOption).toHaveJSProperty('disabled', true);
  await expect(page.getByText('OpenRouter free tier lacks conversation memory.')).toBeVisible();

  // 7. Switch back to gemini-api: option is re-enabled, mode selection survives
  await providerSelect.selectOption('gemini-api');
  await expect(providerSelect).toHaveValue('gemini-api');
  await expect(sameOption).toHaveJSProperty('disabled', false);
  await expect(updaterSelect).toHaveValue('same_gm_conversation');
});
