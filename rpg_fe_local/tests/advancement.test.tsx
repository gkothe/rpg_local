import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Advancement from '../src/features/advancement/Advancement';
import AwardedTotal from '../src/features/advancement/AwardedTotal';
import { notifyAdvancement } from '../src/features/advancement/events';
import type { Review } from '../src/features/advancement/types';
import { fixtureCampaign, options } from './fixtures';

afterEach(() => vi.unstubAllGlobals());
const campaign = fixtureCampaign();
campaign.characters[0]!.type = 'player';
const settings = {
  ...options,
  advancement: {
    statuses: [],
    actions: [
      { id: 'reverse', label: 'Reverse review' },
      { id: 'discard', label: 'Discard proposal' },
    ],
    kinds: [],
    bases: [],
    outcomes: [
      { id: 'reviewed', label: 'Reviewed' },
      { id: 'needs_guidance', label: 'Needs guidance' },
    ],
    limits: {},
  },
};
function review(): Review {
  return {
    id: 'review1',
    campaignId: campaign.id,
    requestId: 'request1',
    status: 'ready',
    imported: false,
    proposalDigest: 'digest1',
    adjustmentReason: null,
    safeError: null,
    reviewedTurnIds: ['turn1'],
    appliedAt: null,
    awards: [],
    proposal: {
      outcome: 'reviewed',
      rewardSystem: { key: 'test_edition', label: 'Test game', editionLabel: null },
      explanation: 'Defeated the bandits.',
      progressionBasis: 'Combat and achievements.',
      progressionBasisKind: 'model_knowledge',
      awards: [
        {
          characterId: campaign.characters[0]!.id,
          kind: 'resource',
          unitKey: 'xp',
          unitLabel: 'XP',
          amount: 10,
          reason: 'Battle won',
          basis: 'System combat progression',
          basisKind: 'model_knowledge',
          evidenceTurnIds: ['turn1'],
        },
      ],
      cumulativeSummary: 'Bandits defeated.',
      pendingObjectives: [],
      ruleEvidence: [],
    },
  };
}
const response = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });

it('stages direct edits, applies only the saved digest and tells the player to update manually', async () => {
  let saved = review();
  const decisions: { path: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(init.body as string);
        decisions.push({ path, body });
        if (path.endsWith('/adjust'))
          saved = { ...saved, proposal: body.proposal, proposalDigest: 'digest2' };
        else if (path.endsWith('/apply'))
          saved = {
            ...saved,
            status: 'applied',
            awards: saved.proposal!.awards.map((a) => ({
              ...a,
              id: 'award1',
              currencyId: 'currency1',
              recipientName: 'Marta',
            })),
            appliedAt: '2026-01-01T00:00:00Z',
          };
        return response(saved);
      }
      return response({
        reviews: [saved],
        outstandingTurnCount: saved.status === 'applied' ? 0 : 1,
        nextCursor: null,
      });
    })
  );
  render(<Advancement campaign={campaign} options={settings} onSaved={async () => {}} />);
  const amount = await screen.findByLabelText('Award amount');
  fireEvent.change(amount, { target: { value: '15.5' } });
  expect(
    JSON.parse((screen.getByLabelText('Full advancement proposal') as HTMLTextAreaElement).value)
      .awards[0].amount
  ).toBe(15.5);
  expect(
    screen.getByRole('button', { name: 'Apply awards and mark turns reviewed' })
  ).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Reason for adjustment'), {
    target: { value: 'Correct battle reward' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save proposal edits' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Apply awards and mark turns reviewed' })
    ).toBeEnabled()
  );
  expect(decisions).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Apply awards and mark turns reviewed' }));
  await screen.findByText(/Awarded: Marta: 15.5 XP. Update your character sheet manually/);
  expect(decisions[1]!.body.proposalDigest).toBe('digest2');
  expect(decisions.every((d) => d.path.includes('/advancement/'))).toBe(true);
});

it('replays an uncertain Apply using the same request identity', async () => {
  const saved = review();
  const ids: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        ids.push(JSON.parse(init.body as string).requestId);
        if (ids.length === 1) throw new TypeError('Lost response');
        return response({ ...saved, status: 'applied', awards: [] });
      }
      return response({ reviews: [saved], outstandingTurnCount: 1, nextCursor: null });
    })
  );
  render(<Advancement campaign={campaign} options={settings} onSaved={async () => {}} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Apply awards and mark turns reviewed' })
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Retry uncertain request' }));
  await screen.findByText(/Update your character sheet manually/);
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
});

it('polling keeps direct edits and no-award proposals remain applicable', async () => {
  const saved = review();
  saved.proposal!.awards = [];
  const fetcher = vi.fn(async () =>
    response({ reviews: [saved], outstandingTurnCount: 1, nextCursor: null })
  );
  vi.stubGlobal('fetch', fetcher);
  render(<Advancement campaign={campaign} options={settings} onSaved={async () => {}} />);
  const explanation = await screen.findByLabelText('Review explanation');
  expect(
    screen.getByRole('button', { name: 'Apply awards and mark turns reviewed' })
  ).toBeEnabled();
  fireEvent.change(explanation, { target: { value: 'My adjusted explanation' } });
  await waitFor(() => expect(fetcher.mock.calls.length).toBeGreaterThan(1), { timeout: 3500 });
  expect(explanation).toHaveValue('My adjusted explanation');
});

it('one read-only award field separates currencies and refreshes on ledger changes', async () => {
  let total = 12;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      response({
        players: [
          {
            characterId: campaign.characters[0]!.id,
            totals: [
              { currencyId: 'a', systemLabel: 'D&D', unitLabel: 'XP', kind: 'resource', total },
              {
                currencyId: 'b',
                systemLabel: 'Other game',
                unitLabel: 'Improvement checks',
                kind: 'eligibility',
                total: 2,
              },
            ],
          },
        ],
        ledger: [],
        ledgerDigest: 'd',
      })
    )
  );
  render(<AwardedTotal campaignId={campaign.id} characterId={campaign.characters[0]!.id} />);
  await waitFor(() =>
    expect(screen.getByLabelText('Awarded through this feature')).toHaveTextContent(
      '12 XP (D&D); 2 Improvement checks (Other game)'
    )
  );
  expect(screen.queryByRole('spinbutton')).toBeNull();
  total = 20;
  notifyAdvancement(campaign.id);
  await waitFor(() =>
    expect(screen.getByLabelText('Awarded through this feature')).toHaveTextContent('20 XP')
  );
  total = 0.0001;
  notifyAdvancement(campaign.id);
  await waitFor(() =>
    expect(screen.getByLabelText('Awarded through this feature')).toHaveTextContent('0.0001 XP')
  );
});

it('a failed totals request displays unavailable, never a fabricated zero', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('Database unavailable');
    })
  );
  render(<AwardedTotal campaignId={campaign.id} characterId={campaign.characters[0]!.id} />);
  await screen.findByText('Database unavailable');
  expect(screen.getByLabelText('Awarded through this feature')).toHaveTextContent('Unavailable');
});
