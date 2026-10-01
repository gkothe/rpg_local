import { test, expect } from '@playwright/test';
import { fixtureCampaign, fixtureTurn, options, providers } from '../fixtures';
import type { Turn } from '../../src/services/types';
test('terminal dice stay visible, retry preserves drafts and undo retains the audit', async ({
  page,
}) => {
  let campaign = fixtureCampaign();
  const roll = {
    id: '55555555-5555-4555-8555-555555555555',
    sessionId: '66666666-6666-4666-8666-666666666666',
    campaignId: campaign.id,
    slot: 0,
    reason: 'Climb',
    declaration: '+2 agility; target 12',
    groups: [{ label: 'Climb check', sides: 20, faces: [9] }],
    createdAt: '2026-10-01T12:00:00Z',
  };
  const failed: Turn = {
    ...fixtureTurn(),
    status: 'cancelled',
    narrative: null,
    error: 'Cancelled after rolling',
    diceSessionId: roll.sessionId,
    rolls: [roll],
    rollInterpretations: [],
    diceRetry: { available: true, reason: null },
  };
  campaign = { ...campaign, turns: [failed] };
  let retry: Turn | undefined;
  let exported: Record<string, unknown>;
  let imported: typeof campaign | undefined;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown;
    if (path === '/api/settings') data = options;
    else if (path === '/api/providers')
      data = [
        { ...providers[0]!, dice: { supported: true, reason: null } },
        {
          ...providers[0]!,
          id: 'agy',
          name: 'Antigravity',
          dice: { supported: false, reason: 'Exclusive dice attachment is not verified' },
        },
      ];
    else if (path.endsWith('/retry')) {
      expect(route.request().postDataJSON()).toMatchObject({
        revision: 1,
        settings: campaign.settings,
      });
      retry = {
        ...failed,
        id: '77777777-7777-4777-8777-777777777777',
        status: 'pending',
        error: null,
        retryOfTurnId: failed.id,
        rolls: [],
        diceRetry: undefined,
      };
      data = retry;
    } else if (retry && path.endsWith(`/turns/${retry.id}`)) {
      retry = {
        ...retry,
        status: 'completed',
        narrative: 'The rope helps you reach the ledge.',
        rolls: [roll],
        rollInterpretations: [
          {
            rollId: roll.id,
            explanation: 'Total 11; failure',
            corrections: [{ explanation: 'Rope bonus brings the total to 13; success' }],
          },
        ],
      };
      campaign = {
        ...campaign,
        revision: 2,
        turns: [
          {
            ...failed,
            diceRetry: { available: false, reason: 'A later attempt superseded this one' },
          },
          retry,
        ],
      };
      data = retry;
    } else if (path.endsWith('/undo')) {
      campaign = {
        ...campaign,
        revision: 3,
        turns: campaign.turns.map((turn) =>
          turn.id === retry?.id ? { ...turn, undone: true } : turn
        ),
      };
      data = campaign;
    } else if (path.endsWith('/export')) {
      exported = {
        format: 'local-rpg',
        version: 2,
        campaign,
        turns: campaign.turns,
        diceRecords: [roll],
      };
      data = exported;
    } else if (path === '/api/campaigns/import') {
      expect(route.request().postDataJSON().archive).toEqual(exported);
      imported = {
        ...campaign,
        id: '88888888-8888-4888-8888-888888888888',
        turns: campaign.turns.map((turn) => ({
          ...turn,
          diceRetry: { available: false, reason: 'Imported dice audit cannot execute' },
        })),
      };
      data = imported;
    } else if (imported && path === `/api/campaigns/${imported.id}`) data = imported;
    else if (path === '/api/campaigns') data = [campaign];
    else if (path === `/api/campaigns/${campaign.id}`) data = campaign;
    else data = [];
    await route.fulfill({ json: { data } });
  });
  await page.goto(`/campaigns/${campaign.id}`);
  await expect(page.getByText('Declared before rolling: +2 agility; target 12')).toBeVisible();
  await expect(page.getByLabel('AI CLI').locator('option[value="agy"]')).toHaveAttribute(
    'disabled',
    ''
  );
  await page.getByLabel('Your action').fill('Keep this unsent draft');
  await page.getByRole('button', { name: 'Retry with saved dice' }).click();
  await expect(page.getByText('GM interpretation: Total 11; failure')).toBeVisible();
  await expect(
    page.getByText('Correction: Rope bonus brings the total to 13; success')
  ).toBeVisible();
  await expect(page.getByLabel('Your action')).toHaveValue('Keep this unsent draft');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Undo last turn' }).click();
  await expect(page.getByText('The rope helps you reach the ledge.')).toHaveCount(0);
  await page.getByLabel('Show turn audit (including undone and failed attempts)').check();
  await expect(
    page.getByText('Correction: Rope bonus brings the total to 13; success')
  ).toBeVisible();
  await expect(page.getByLabel('Your action')).toHaveValue('Keep this unsent draft');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const stream = await (await downloaded).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const archiveBuffer = Buffer.concat(chunks);
  expect(JSON.parse(archiveBuffer.toString()).diceRecords[0].groups[0].faces).toEqual([9]);
  await page.goto('/');
  await page.getByLabel('Import campaign').setInputFiles({
    name: 'dice-archive.json',
    mimeType: 'application/json',
    buffer: archiveBuffer,
  });
  await expect(page).toHaveURL(/88888888-8888-4888-8888-888888888888/);
  await page.getByLabel('Show turn audit (including undone and failed attempts)').check();
  await expect(
    page.getByText('Correction: Rope bonus brings the total to 13; success')
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry with saved dice' })).toHaveCount(0);
});
