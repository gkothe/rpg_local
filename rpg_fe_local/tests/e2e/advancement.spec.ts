import { test, expect } from '@playwright/test';
import { fixtureCampaign, options, providers } from '../fixtures';
import type { Review } from '../../src/features/advancement/types';

test('manual advancement review edits, Apply, player total and phone layout', async ({ page }) => {
  const campaign = fixtureCampaign();
  campaign.characters[0]!.type = 'player';
  let current: Review | null = null;
  let total = 0;
  const posts: string[] = [];
  const settings = {
    ...options,
    advancement: {
      statuses: [],
      actions: [
        { id: 'discard', label: 'Discard' },
        { id: 'reverse', label: 'Reverse' },
      ],
      kinds: [],
      bases: [],
      outcomes: [{ id: 'reviewed', label: 'Reviewed' }],
      limits: {},
    },
  };
  const base = `/api/campaigns/${campaign.id}/advancement`;
  await page.route('**/api/**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    let data: unknown = [];
    if (path === '/api/settings') data = settings;
    else if (path === '/api/providers') data = providers;
    else if (path === '/api/campaigns') data = [campaign];
    else if (path === `/api/campaigns/${campaign.id}`) data = campaign;
    else if (path === `${base}/summary`)
      data = {
        players: [
          {
            characterId: campaign.characters[0]!.id,
            totals: total
              ? [
                  {
                    currencyId: 'xp1',
                    systemLabel: 'Test RPG',
                    unitLabel: 'XP',
                    kind: 'resource',
                    total,
                  },
                ]
              : [],
          },
        ],
        ledger: [],
        ledgerDigest: 'd',
      };
    else if (path === `${base}/reviews` && req.method() === 'GET')
      data = {
        reviews: current ? [current] : [],
        outstandingTurnCount: total ? 0 : 2,
        nextCursor: null,
      };
    else if (path.startsWith(base) && req.method() === 'POST') {
      posts.push(path);
      const body = req.postDataJSON();
      if (path === `${base}/reviews`)
        current = {
          id: 'review1',
          campaignId: campaign.id,
          requestId: body.requestId,
          status: 'ready',
          imported: false,
          proposalDigest: 'digest1',
          safeError: null,
          adjustmentReason: null,
          reviewedTurnIds: ['t1', 't2'],
          appliedAt: null,
          awards: [],
          proposal: {
            outcome: 'reviewed',
            rewardSystem: { key: 'test_rpg', label: 'Test RPG', editionLabel: null },
            explanation: 'Battle won.',
            progressionBasis: 'Use combat and achievements.',
            progressionBasisKind: 'model_knowledge',
            awards: [
              {
                characterId: campaign.characters[0]!.id,
                kind: 'resource',
                unitKey: 'xp',
                unitLabel: 'XP',
                amount: 10,
                reason: 'Defeated bandits.',
                basis: 'System combat rewards',
                basisKind: 'model_knowledge',
                evidenceTurnIds: ['t1', 't2'],
              },
            ],
            cumulativeSummary: 'Battle completed.',
            pendingObjectives: [],
            ruleEvidence: [],
          },
        };
      else if (path.endsWith('/adjust'))
        current = { ...current!, proposal: body.proposal, proposalDigest: 'digest2' };
      else if (path.endsWith('/apply')) {
        total = current!.proposal!.awards[0]!.amount!;
        current = {
          ...current!,
          status: 'applied',
          appliedAt: '2026-01-01T00:00:00Z',
          awards: current!.proposal!.awards.map((a) => ({
            ...a,
            id: 'a1',
            recipientName: 'Marta',
            currencyId: 'xp1',
          })),
        };
      }
      data = current;
    } else if (path.startsWith(`${base}/reviews/`)) data = current;
    else if (path.endsWith('/sheet-layout')) data = { fields: [] };
    await route.fulfill({ status: 200, json: { data } });
  });
  await page.goto(`/campaigns/${campaign.id}?tab=journal`);
  await page.getByRole('tab', { name: 'Advancement', exact: true }).click();
  await page.getByRole('button', { name: 'Review advancement', exact: true }).click();
  await page.getByLabel('Award amount').fill('25');
  await page.getByLabel('Reason for adjustment').fill('Correct the battle value');
  await page.getByRole('button', { name: 'Save proposal edits' }).click();
  await page.getByRole('button', { name: 'Apply awards and mark turns reviewed' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Update your character sheet manually' })
  ).toBeVisible();
  await page.goto(`/campaigns/${campaign.id}?tab=characters`);
  await expect(page.getByLabel('Awarded through this feature')).toHaveText('25 XP (Test RPG)');
  expect(posts.every((p) => p.includes('/advancement/'))).toBe(true);
  expect(campaign.characters[0]!.attributes).toEqual({ health: 12 });
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.getByLabel('Awarded through this feature')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
});
