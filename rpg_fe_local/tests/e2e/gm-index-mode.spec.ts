import { expect, test } from '@playwright/test';
import { fixtureCampaign, fixtureTurn, options, providers } from '../fixtures';

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
