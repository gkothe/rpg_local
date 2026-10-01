import { test, expect } from '@playwright/test';

test('actual Antigravity selector, persisted GM turn, model switch and full undo', async ({
  page,
}) => {
  test.skip(
    process.env.LOCAL_RPG_ANTIGRAVITY_TESTS !== '1',
    'Requires authorized Antigravity and isolated PostgreSQL backend.'
  );
  test.setTimeout(180000);
  const name = `Antigravity browser fixture ${Date.now()}`;
  let campaignId = '';
  await page.goto('/new');
  const origin = new URL(page.url()).origin;
  const headers = { 'X-RPG-Client': 'local-rpg', Origin: origin };
  try {
    await page.getByLabel('Campaign name').fill(name);
    await expect(page.getByLabel('AI CLI').locator('option[value="agy"]')).toBeEnabled({
      timeout: 30000,
    });
    await page.getByLabel('AI CLI').selectOption('agy');
    await page
      .getByRole('combobox', { name: 'Model', exact: true })
      .selectOption('gemini-3.8-flash');
    await page.getByLabel('Effort').selectOption('low');
    await page.getByRole('button', { name: 'Create campaign' }).click();
    await expect(page.getByRole('heading', { name })).toBeVisible();
    campaignId = /\/campaigns\/([0-9a-f-]+)/.exec(page.url())![1];
    const created = await page.request.post(`/api/campaigns/${campaignId}/characters`, {
      headers,
      data: {
        revision: 0,
        name: 'Ranger',
        type: 'player',
        attributes: { health: 8 },
        inventory: { potions: 1 },
        notes: 'Private fixture note.',
      },
    });
    expect(created.ok()).toBeTruthy();
    await page.reload();
    await page
      .getByLabel('Your action')
      .fill(
        'Drink the healing potion. Restore Ranger health from 8 to 12 and consume the only potion. Apply both changes and narrate one sentence.'
      );
    await page.getByRole('button', { name: 'Send action' }).click();
    await expect
      .poll(
        async () => {
          const data = (await (await page.request.get(`/api/campaigns/${campaignId}`)).json()).data;
          return data.characters[0].attributes.health;
        },
        { timeout: 60000 }
      )
      .toBe(12);
    await expect(page.getByRole('button', { name: 'Undo last turn' })).toBeEnabled();
    await page
      .getByRole('combobox', { name: 'Model', exact: true })
      .selectOption('gemini-3.7-flash');
    await page.getByLabel('Effort').selectOption('low');
    await expect(page.getByRole('status')).toHaveText('Game master settings saved.');
    await page
      .getByLabel('Your action')
      .fill('Describe my health and remaining potions in one sentence. Do not change any state.');
    await page.getByRole('button', { name: 'Send action' }).click();
    await expect
      .poll(
        async () => {
          const data = (await (await page.request.get(`/api/campaigns/${campaignId}`)).json()).data;
          return data.turns.filter((turn: { status: string }) => turn.status === 'completed')
            .length;
        },
        { timeout: 60000 }
      )
      .toBe(2);
    const detail = (await (await page.request.get(`/api/campaigns/${campaignId}`)).json()).data;
    expect(detail.turns[1].settings.model).toBe('gemini-3.7-flash');
    expect(
      JSON.parse(detail.turns[1].context.prompt).mandatory.characters[0].attributes.health
    ).toBe(12);
    for (let index = 0; index < 2; index++) {
      page.once('dialog', (dialog) => dialog.accept());
      await page.getByRole('button', { name: 'Undo last turn' }).click();
      await expect(page.getByRole('button', { name: 'Undo last turn' })).toBeEnabled({
        enabled: index === 0,
      });
    }
    const restored = (await (await page.request.get(`/api/campaigns/${campaignId}`)).json()).data;
    expect(restored.characters[0].attributes.health).toBe(8);
    expect(restored.characters[0].inventory.potions).toBe(1);
    expect(restored.characters[0].notes).toBe('Private fixture note.');
  } finally {
    if (campaignId) {
      const response = await page.request.get(`/api/campaigns/${campaignId}`);
      if (response.ok()) {
        const detail = (await response.json()).data;
        for (const turn of detail.turns) {
          if (['queued', 'running'].includes(turn.status))
            await page.request.post(`/api/campaigns/${campaignId}/turns/${turn.id}/cancel`, {
              headers,
              data: {},
            });
        }
        const current = (await (await page.request.get(`/api/campaigns/${campaignId}`)).json())
          .data;
        await page.request.delete(`/api/campaigns/${campaignId}`, {
          headers,
          data: { revision: current.revision },
        });
      }
    }
  }
});
