import { test, expect } from '@playwright/test';
import { fixtureCampaign, fixtureTurn, options, providers } from '../fixtures';

test('Play opens at the latest message after settings load and preserves reading older messages', async ({
  page,
}) => {
  const campaign = fixtureCampaign();
  campaign.turns = Array.from({ length: 12 }, (_, index) => ({
    ...fixtureTurn(),
    id: `saved-turn-${index}`,
    narrative: `Scene ${index}. ${'The courtyard is quiet. '.repeat(30)}`,
  }));
  let releaseSettings!: () => void;
  const settingsReady = new Promise<void>((resolve) => {
    releaseSettings = resolve;
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/settings') await settingsReady;
    const data =
      path === '/api/settings'
        ? options
        : path === '/api/providers'
          ? providers
          : path === `/api/campaigns/${campaign.id}`
            ? campaign
            : [];
    await route.fulfill({ json: { data } });
  });
  await page.goto(`/campaigns/${campaign.id}`);
  await expect(page.getByRole('heading', { name: campaign.name, exact: true })).toBeVisible();
  releaseSettings();
  const transcript = page.getByRole('region', { name: 'Campaign transcript' });
  await expect(transcript.getByText(/^Scene 11\./)).toBeVisible();
  await expect
    .poll(() =>
      transcript.evaluate((element) => ({
        overflows: element.scrollHeight > element.clientHeight,
        remaining: element.scrollHeight - element.clientHeight - element.scrollTop,
      }))
    )
    .toEqual({ overflows: true, remaining: 0 });
  await transcript.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });
  campaign.turns.at(-1)!.narrative = 'Updated latest scene.';
  await page.evaluate(() => window.dispatchEvent(new Event('rpg-reconnected')));
  await expect(transcript.getByText('Updated latest scene.')).toBeAttached();
  expect(await transcript.evaluate((element) => element.scrollTop)).toBe(0);
});

test('book gameplay allows High and Default without an extra effort gate', async ({ page }) => {
  const campaign = fixtureCampaign();
  campaign.ruleSystemId = 'vampire';
  campaign.settings.effort = 'high';
  const catalog = providers.map((provider) => ({
    ...provider,
    rules: { supported: true, reason: null },
    models: provider.models.map((model) => ({
      ...model,
      rules: { supported: true, reason: null, efforts: ['medium'] },
    })),
  }));
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data =
      path === '/api/providers'
        ? catalog
        : path === '/api/settings'
          ? options
          : path === `/api/campaigns/${campaign.id}`
            ? campaign
            : [];
    await route.fulfill({ json: { data } });
  });
  await page.goto(`/campaigns/${campaign.id}`);
  await page.getByLabel('Your action').fill('Start');
  await expect(page.getByRole('button', { name: 'Send action' })).toBeEnabled();
  campaign.settings.effort = null;
  await page.reload();
  await page.getByLabel('Your action').fill('Start');
  await expect(page.getByRole('button', { name: 'Send action' })).toBeEnabled();
});

test('player and NPC sections swap between reading and JSON editing and save independently', async ({
  page,
}) => {
  let campaign = fixtureCampaign();
  campaign.characters.push({
    ...campaign.characters[0],
    id: 'player',
    name: 'Sigurd',
    type: 'player',
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path === '/api/settings') data = options;
    else if (path === '/api/providers') data = providers;
    else if (path.includes('/characters/') && route.request().method() === 'PATCH') {
      const patch = route.request().postDataJSON();
      expect(Object.keys(patch).sort()).toEqual(['inventory', 'revision']);
      expect(patch.revision).toBe(campaign.revision);
      campaign = {
        ...campaign,
        revision: campaign.revision + 1,
        characters: campaign.characters.map((c) =>
          c.id === path.split('/').at(-1) ? { ...c, inventory: patch.inventory } : c
        ),
      };
      data = campaign;
    } else if (path === `/api/campaigns/${campaign.id}`) data = campaign;
    await route.fulfill({ json: { data } });
  });
  await page.goto(`/campaigns/${campaign.id}`);
  for (const [tab, name] of [
    ['Characters', 'Sigurd'],
    ['NPCs', 'Marta'],
  ]) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    if (tab === 'NPCs')
      await page
        .locator('summary')
        .filter({ hasText: /^Marta$/ })
        .click();
    await expect(page.getByRole('button', { name: 'Delete character', exact: true })).toHaveCount(
      tab === 'NPCs' ? 1 : 0
    );
    await expect(
      page
        .locator('.character-actions')
        .getByRole('button', { name: 'Save character', exact: true })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Inventory', exact: true }).click();
    const section = page.getByRole('region', { name: `${name} Inventory`, exact: true });
    await expect(section.getByText('silver', { exact: true })).toBeVisible();
    await section.getByRole('button', { name: 'Edit JSON' }).click();
    await expect(section.getByText('silver', { exact: true })).toHaveCount(0);
    await section.getByLabel('Inventory JSON').fill('{"sword":2}');
    await section.getByRole('button', { name: 'View', exact: true }).click();
    await section.getByRole('button', { name: 'Edit JSON' }).click();
    await expect(section.getByLabel('Inventory JSON')).toHaveValue('{"sword":2}');
    await section.getByRole('button', { name: 'Save Inventory' }).click();
    await expect(section.getByRole('button', { name: 'Edit JSON' })).toBeVisible();
    await expect(section.getByText('sword', { exact: true })).toBeVisible();
    await expect(section.getByLabel('Inventory JSON')).toHaveCount(0);
  }
});
test('PDF source text can be optionally corrected after import', async ({ page }) => {
  let campaign = fixtureCampaign();
  campaign.sources = [
    {
      id: 'pdf-source',
      name: 'Scanned rules',
      kind: 'pdf',
      text: 'The bridgc is closcd.',
      status: 'confirmed',
      version: 1,
      pages: [],
      warnings: ['OCR text needs review.'],
    },
  ];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown;
    if (path === '/api/settings') data = options;
    else if (path === '/api/providers') data = providers;
    else if (path.endsWith('/sources/pdf-source') && route.request().method() === 'PATCH') {
      expect(route.request().postDataJSON()).toEqual({
        revision: 1,
        text: 'The bridge is closed.',
        confirmed: true,
      });
      campaign = {
        ...campaign,
        revision: 2,
        sources: [
          {
            ...campaign.sources[0],
            text: 'The bridge is closed.',
            status: 'confirmed',
            version: 2,
          },
        ],
      };
      data = campaign;
    } else if (path === `/api/campaigns/${campaign.id}`) data = campaign;
    else data = [];
    await route.fulfill({ json: { data } });
  });
  await page.goto(`/campaigns/${campaign.id}`);
  await page.getByRole('button', { name: 'Sources', exact: true }).click();
  await expect(page.getByText('pdf · confirmed · version 1')).toBeVisible();
  await page.getByRole('button', { name: 'View / edit text' }).click();
  await expect(page.getByText('OCR text needs review.')).toBeVisible();
  await page.getByLabel('Extracted text').fill('The bridge is closed.');
  await page.getByRole('button', { name: 'Confirm corrected text' }).click();
  await expect(page.getByText('pdf · confirmed · version 2')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Review: Scanned rules' })).toHaveCount(0);
});
test('desktop play preserves typed drafts, commits changes and undoes the turn', async ({
  page,
}) => {
  let campaign = fixtureCampaign(),
    job = fixtureTurn();
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname,
      method = route.request().method();
    let data: unknown;
    if (path === '/api/settings') data = options;
    else if (path === '/api/providers') data = providers;
    else if (path === '/api/templates') data = [];
    else if (path === '/api/campaigns') data = [campaign];
    else if (path.endsWith('/undo')) {
      campaign = { ...campaign, revision: 3, turns: [{ ...job, undone: true }] };
      data = campaign;
    } else if (path.endsWith('/turns') && method === 'POST') {
      job = { ...job, action: route.request().postDataJSON().action, status: 'pending' };
      data = job;
    } else if (path.includes('/turns/')) {
      job = { ...job, status: 'completed' };
      campaign = { ...campaign, revision: 2, turns: [job] };
      data = job;
    } else if (path === `/api/campaigns/${campaign.id}`) data = campaign;
    else return route.fulfill({ status: 404, json: { detail: 'Unmocked test route' } });
    await route.fulfill({ json: { data } });
  });
  await page.goto(`/campaigns/${campaign.id}`);
  await expect(page.getByRole('heading', { name: 'The Northern Road' })).toBeVisible();
  await page.getByLabel('Your action').fill('Open the door');
  await page.getByRole('button', { name: 'Send action' }).click();
  await page.getByLabel('Your action').fill('Keep this unsent draft');
  await expect(page.getByText(job.narrative!)).toBeVisible();
  await expect(page.getByLabel('Your action')).toHaveValue('Keep this unsent draft');
  await expect(page.getByLabel('Show debug info')).not.toBeChecked();
  await expect(page.getByText('1 state change', { exact: true })).toHaveCount(0);
  await page.getByLabel('Show debug info').check();
  await page.getByText('1 state change', { exact: true }).click();
  await expect(page.getByText(job.changes[0])).toBeVisible();
  await page.getByLabel('Show debug info').uncheck();
  await expect(page.getByText('1 state change', { exact: true })).toHaveCount(0);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Undo last turn' }).click();
  await expect(page.getByText(job.narrative!)).toHaveCount(0);
  await expect(page.getByLabel('Your action')).toHaveValue('Keep this unsent draft');
});
test('setup submits only explicit campaign fields', async ({ page }) => {
  let created = false;
  const campaign = fixtureCampaign();
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown;
    if (path === '/api/providers') data = providers;
    else if (path === '/api/settings') data = options;
    else if (path === '/api/campaigns' && route.request().method() === 'POST') {
      expect(route.request().postDataJSON()).toMatchObject({
        name: 'Fresh campaign',
        description: '',
        settings: { provider: '', model: '', effort: null },
      });
      created = true;
      data = campaign;
    } else if (path === `/api/campaigns/${campaign.id}`) data = campaign;
    else data = [];
    await route.fulfill({ json: { data } });
  });
  await page.goto('/new');
  await page.getByLabel('Campaign name').fill('Fresh campaign');
  await page.getByRole('button', { name: 'Create campaign' }).click();
  await expect(page.getByRole('heading', { name: campaign.name })).toBeVisible();
  await expect(
    page.getByText('Campaign created. Imported documents are ready to use.', { exact: false })
  ).toBeVisible();
  await expect(page.getByLabel('Markdown, text or PDF files (select multiple)')).toBeHidden();
  await page.getByRole('button', { name: 'Add source', exact: true }).click();
  await expect(page.getByLabel('Markdown, text or PDF files (select multiple)')).toBeVisible();
  await expect(page.getByLabel('Public Google Docs URL')).toBeVisible();
  await page.getByLabel('Source name').fill('Unfinished source');
  await page.getByRole('button', { name: 'Back to sources' }).click();
  await expect(page.getByLabel('Source name')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Rules & source material' })).toBeVisible();
  await page.getByRole('button', { name: 'Add source', exact: true }).click();
  await expect(page.getByLabel('Source name')).toHaveValue('Unfinished source');
  expect(created).toBe(true);
});
test('transcript button precedes messages and checkboxes sit below the composer', async ({
  page,
}) => {
  const campaign = fixtureCampaign();
  campaign.memory = {
    id: 'long-memory',
    text: 'The campaign continues through the crowded arena. '.repeat(200),
    valid: true,
    coveredTurnIds: [],
    createdAt: new Date().toISOString(),
  };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data =
      path === '/api/settings'
        ? options
        : path === '/api/providers'
          ? providers
          : path === `/api/campaigns/${campaign.id}`
            ? campaign
            : [];
    await route.fulfill({ json: { data } });
  });
  await page.goto(`/campaigns/${campaign.id}`);
  for (const height of [500, 900]) {
    await page.setViewportSize({ width: 1280, height });
    const transcript = await page.locator('.transcript').boundingBox();
    const sidebar = await page.locator('.campaign-aside').boundingBox();
    expect(sidebar!.height).toBe(transcript!.height);
    expect(sidebar!.y).toBe(transcript!.y);
    await expect(page.locator('.transcript > :first-child')).toBeVisible();
    await expect(page.locator('.transcript > :first-child')).toHaveText(
      'Load full saved transcript'
    );
    await expect(page.locator('.campaign-aside')).toBeEmpty();
  }
  const composer = page.locator('.composer');
  const transcriptOptions = page.locator('.transcript-options');
  for (const label of [
    'Show turn audit (including undone and failed attempts)',
    'Show debug info',
  ]) {
    await expect(transcriptOptions.getByLabel(label)).toBeVisible();
  }
  await expect(composer.locator('.transcript-options')).toHaveCount(0);
  const panel = await composer.boundingBox();
  const checkboxes = await transcriptOptions.boundingBox();
  expect(checkboxes!.y).toBeGreaterThanOrEqual(panel!.y + panel!.height);
  await expect(
    page.getByRole('button', { name: 'Download campaign backup', exact: true })
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save campaign template' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Utility', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Download campaign backup', exact: true })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save campaign template' })).toBeVisible();
  await expect(page.getByLabel('Your action')).not.toBeVisible();
  await page.getByText('Reusable character templates', { exact: true }).click();
  await expect(page.getByRole('combobox', { name: /Character template/ })).toBeVisible();
  await page.getByRole('button', { name: 'Characters', exact: true }).click();
  await expect(page.getByText('Reusable character templates', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Add a character', { exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'Utility', exact: true }).click();
  await page.getByText('Add a character', { exact: true }).click();
  const creator = page
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: /^Add a character$/ }) });
  await creator.getByLabel('Name', { exact: true }).fill('Unfinished character');
  await page.getByRole('button', { name: 'Characters', exact: true }).click();
  await page.getByRole('button', { name: 'Utility', exact: true }).click();
  await expect(creator.getByLabel('Name', { exact: true })).toHaveValue('Unfinished character');
  await expect(page.getByRole('button', { name: 'Download campaign backup' })).toHaveAttribute(
    'title',
    /JSON archive/
  );
  await page.getByRole('button', { name: 'Journal', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'GM auxiliary state' })).not.toBeVisible();
  await expect(page.getByRole('textbox', { name: /^Description/ })).not.toBeVisible();
  await page.getByRole('button', { name: 'Game master', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'GM auxiliary state' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save GM state' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: /^Description/ })).toBeVisible();
  await expect(page.getByLabel('GM instructions')).toBeVisible();
  await expect(page.getByText('Pinned campaign facts', { exact: true })).toHaveCount(0);
});

test('journal layout has no horizontal overflow across standard widths', async ({ page }) => {
  const campaign = { ...fixtureCampaign(), turns: [fixtureTurn()] };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      json: {
        data:
          path === '/api/settings'
            ? options
            : path === '/api/providers'
              ? providers
              : path === '/api/templates'
                ? []
                : path === `/api/campaigns/${campaign.id}`
                  ? campaign
                  : [campaign],
      },
    });
  });
  await page.goto(`/campaigns/${campaign.id}`);
  await expect(page.getByText(fixtureTurn().narrative!)).toBeVisible();
  const playerBubble = await page.locator('.player-action').boundingBox();
  const gmBubble = await page.locator('.gm-message').boundingBox();
  expect(playerBubble!.x).toBeGreaterThan(gmBubble!.x);
  await expect(page.locator('.message-time')).toHaveCount(2);
  expect(
    await page.locator('.transcript').evaluate((element) => getComputedStyle(element).overflowY)
  ).toBe('auto');
  await expect(page.getByLabel('AI CLI')).toBeHidden();
  await page.getByRole('button', { name: 'Game master', exact: true }).click();
  await expect(page.getByLabel('AI CLI')).toBeVisible();
  await expect(page.getByLabel('System rules', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Your action')).toBeHidden();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByLabel('AI CLI')).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/journal-desktop.png', fullPage: true });
  for (const width of [320, 375, 768, 1024, 1280, 1440, 1920, 2560]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `overflow at ${width}px`
    ).toBe(true);
    await expect(page.getByRole('button', { name: 'Send action' })).toBeVisible();
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: 'test-results/journal-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'NPCs', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Marta npc' })).toBeHidden();
  await page
    .locator('summary')
    .filter({ hasText: /^Marta$/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Marta npc' })).toBeVisible();
  await expect(page.getByText('health', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Inventory', exact: true }).click();
  await expect(page.getByText('silver', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Description', exact: true }).click();
  await expect(page.getByText('A road warden', { exact: true })).toBeVisible();
  await page.locator('.npc-entry').getByLabel('Name', { exact: true }).fill('Unsaved Marta');
  await page.getByRole('button', { name: 'Characters', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Marta npc' })).toBeHidden();
  await page.getByRole('button', { name: 'NPCs', exact: true }).click();
  await expect(page.locator('.npc-entry').getByLabel('Name', { exact: true })).toHaveValue(
    'Unsaved Marta'
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
});

test('pending GM response shows animated loading and keeps the next-action draft editable', async ({
  page,
}) => {
  const campaign = fixtureCampaign();
  campaign.turns = [{ ...fixtureTurn(), status: 'pending', narrative: null }];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const data =
      url.pathname === '/api/providers'
        ? providers
        : url.pathname === '/api/settings'
          ? options
          : url.pathname.includes('/turns/')
            ? campaign.turns[0]
            : url.pathname === `/api/campaigns/${campaign.id}`
              ? campaign
              : [];
    await route.fulfill({ json: { data } });
  });
  await page.goto(`/campaigns/${campaign.id}`);
  const busy = page.getByRole('button', { name: /GM is responding/ });
  await expect(busy).toBeDisabled();
  await expect(busy.locator('.loading-spinner')).toBeVisible();
  await expect(busy.locator('.loading-spinner')).toHaveCSS('animation-name', 'loading-spin');
  await expect(page.getByRole('button', { name: /Cancel/ })).toBeEnabled();
  await page.getByLabel('Your action').fill('Keep my next action');
  await expect(page.getByLabel('Your action')).toHaveValue('Keep my next action');
});

test('pending narrative editing exposes resume and cancel without displaying the original or allowing new actions', async ({
  page,
}) => {
  const campaign = fixtureCampaign();
  campaign.turns = [
    {
      ...fixtureTurn(),
      status: 'failed',
      narrative: null,
      editingPending: true,
      editingResume: { available: true, reason: null },
      error: 'Editor quota unavailable',
    },
  ];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data =
      path === '/api/providers'
        ? providers
        : path === '/api/settings'
          ? options
          : path === `/api/campaigns/${campaign.id}`
            ? campaign
            : [];
    await route.fulfill({ json: { data } });
  });
  await page.goto(`/campaigns/${campaign.id}`);
  await expect(
    page.getByRole('button', { name: 'Resume narrative editing', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Cancel pending turn', exact: true })
  ).toBeVisible();
  await page.getByLabel('Your action').fill('Continue');
  await expect(page.getByRole('button', { name: 'Send action' })).toBeDisabled();
  await expect(page.locator('.gm-message .prose')).toHaveText('');
});
