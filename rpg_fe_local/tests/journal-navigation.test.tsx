import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PlayPage from '../src/pages/Play';
import { fixtureCampaign, fixtureTurn, options, providers } from './fixtures';

afterEach(() => vi.unstubAllGlobals());

const campaign = fixtureCampaign();
const recent = fixtureTurn();
const older = {
  ...fixtureTurn(),
  id: '99999999-9999-4999-8999-999999999999',
  action: 'Ask Mira about the inn',
  narrative: 'Mira says she is a sister of the temple.',
};
const entry = {
  id: 'e1',
  title: 'Mira',
  kind: 'npc',
  group: 'people_places',
  status: 'active',
  statusLabel: 'Current',
  certainty: 'established',
  certaintyLabel: 'Known',
  overview: 'Mira is the innkeeper.',
  excerpt: false,
  text: 'Mira is the innkeeper.',
  updatedAt: '2026-01-01T00:00:00.000Z',
  connections: [],
  evidence: [],
  history: [],
};

function mount(url: string, turnOverride: Record<string, unknown> = {}) {
  const fetcher = vi.fn(async (path: string) => {
    const reply = (data: unknown) => new Response(JSON.stringify({ data }));
    if (path.startsWith('/api/providers')) return reply(providers);
    if (path === '/api/settings') return reply(options);
    if (path.includes('/journal/entries?'))
      return reply({
        entries: [entry],
        groups: [{ id: 'people_places', label: 'People and places', count: 1 }],
        total: 1,
        nextCursor: null,
      });
    if (path.endsWith('/journal/entries/e1')) return reply(entry);
    if (path.endsWith(`/turns/${older.id}`)) return reply({ ...older, ...turnOverride });
    if (path.includes('/rule-system')) return reply({});
    return reply({ ...campaign, turns: [recent] });
  });
  vi.stubGlobal('fetch', fetcher);
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/campaigns/:id" element={<PlayPage />} />
      </Routes>
    </MemoryRouter>
  );
  return fetcher;
}

it('opens an older conversation by id even though it is not in the recent list, and focuses it', async () => {
  const fetcher = mount(`/campaigns/${campaign.id}?tab=play&turn=${older.id}`);
  const heading = await screen.findByRole('heading', { name: 'Referenced conversation' });
  expect(screen.getByText('Ask Mira about the inn')).toBeInTheDocument();
  expect(screen.getByText('Mira says she is a sister of the temple.')).toBeInTheDocument();
  await waitFor(() => expect(heading).toHaveFocus());
  expect(
    fetcher.mock.calls.some(([p]) =>
      String(p).endsWith(`/campaigns/${campaign.id}/turns/${older.id}`)
    )
  ).toBe(true);
  // The recent transcript is untouched and the draft box is still available.
  expect(screen.getByLabelText('Your action')).toBeInTheDocument();
});

it('labels an undone conversation as no longer part of the story instead of showing it as support', async () => {
  mount(`/campaigns/${campaign.id}?tab=play&turn=${older.id}`, { undone: true });
  expect(await screen.findByText(/no longer part of the story/)).toBeInTheDocument();
  expect(screen.queryByText('Mira says she is a sister of the temple.')).not.toBeInTheDocument();
});

it('opens the Journal tab with the requested entry expanded', async () => {
  mount(`/campaigns/${campaign.id}?tab=journal&entry=e1`);
  expect(await screen.findByRole('button', { name: 'Hide details for Mira' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Journal' })).toHaveAttribute('aria-current', 'page');
});

it('keeps ?setup=1 on the sources tab and ignores unknown tab names', async () => {
  mount(`/campaigns/${campaign.id}?setup=1&tab=journal`);
  await screen.findByLabelText('Your action');
  expect(screen.getByRole('button', { name: 'Sources' })).toHaveAttribute('aria-current', 'page');
  mount(`/campaigns/${campaign.id}?tab=nonsense`);
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: 'Play' }).at(-1)).toHaveAttribute(
      'aria-current',
      'page'
    )
  );
});

it('does not auto-scroll the transcript over an explicit evidence navigation', async () => {
  mount(`/campaigns/${campaign.id}?tab=play&turn=${older.id}`);
  const heading = await screen.findByRole('heading', { name: 'Referenced conversation' });
  await waitFor(() => expect(heading).toHaveFocus());
  // Background updates must not steal focus back to the transcript.
  fireEvent.scroll(screen.getByLabelText('Campaign transcript'));
  expect(heading).toHaveFocus();
});
