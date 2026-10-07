import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import JournalKnowledge from '../src/features/journal/JournalKnowledge';
import Journal from '../src/features/journal/Journal';
import type { JournalEntry, JournalPage } from '../src/services/types';
import { fixtureCampaign, options } from './fixtures';

afterEach(() => vi.unstubAllGlobals());

const entry = (over: Partial<JournalEntry>): JournalEntry => ({
  id: 'e1',
  title: 'Mira',
  kind: 'npc',
  group: 'people_places',
  status: 'active',
  statusLabel: 'Current',
  certainty: 'established',
  certaintyLabel: 'Known',
  overview: 'Mira runs the inn.',
  excerpt: false,
  updatedAt: '2026-01-01T00:00:00.000Z',
  connections: [],
  ...over,
});
const groups = [
  { id: 'people_places', label: 'People and places', count: 1 },
  { id: 'unfinished_business', label: 'Unfinished business', count: 1 },
  { id: 'discoveries', label: 'Discoveries', count: 0 },
];
const page = (entries: JournalEntry[]): JournalPage => ({
  entries,
  groups,
  total: entries.length,
  nextCursor: null,
});
const reply = (data: unknown) => new Response(JSON.stringify({ data }));
const mount = () =>
  render(
    <MemoryRouter>
      <JournalKnowledge campaignId="c1" revision={1} options={options} />
    </MemoryRouter>
  );

it('groups entries under backend labels and omits empty groups', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      reply(
        page([
          entry({}),
          entry({
            id: 'e2',
            title: 'Missing merchant',
            group: 'unfinished_business',
            overview: 'Find him.',
          }),
        ])
      )
    )
  );
  mount();
  expect(await screen.findByRole('region', { name: 'People and places' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Unfinished business' })).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Discoveries' })).not.toBeInTheDocument();
  expect(screen.getByText('Mira runs the inn.')).toBeInTheDocument();
});

it('searches and toggles past items through the server, keeping notes drafts untouched', async () => {
  const fetcher = vi.fn(async (_path: string) => reply(page([entry({})])));
  vi.stubGlobal('fetch', fetcher);
  const campaign = fixtureCampaign();
  render(
    <MemoryRouter>
      <Journal campaign={campaign} options={options} onSaved={async () => {}} />
    </MemoryRouter>
  );
  const notes = screen.getAllByRole('textbox')[0]!;
  fireEvent.change(notes, { target: { value: 'my draft' } });
  await screen.findByText('Mira runs the inn.');
  fireEvent.change(screen.getByLabelText('Search knowledge'), { target: { value: 'mira' } });
  await waitFor(() =>
    expect(fetcher.mock.calls.some((c) => String(c[0]).includes('query=mira'))).toBe(true)
  );
  fireEvent.click(screen.getByLabelText('Show completed/past items'));
  await waitFor(() =>
    expect(fetcher.mock.calls.some((c) => String(c[0]).includes('includePast=true'))).toBe(true)
  );
  expect(notes).toHaveValue('my draft');
});

it('shows empty, no-match and retryable failure states', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'down' }), { status: 500 }))
    .mockImplementation(async () => reply({ ...page([]), groups: [] }));
  vi.stubGlobal('fetch', fetcher);
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Retry knowledge load' }));
  expect(await screen.findByText(/Nothing recorded yet/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Search knowledge'), { target: { value: 'zzz' } });
  expect(await screen.findByText('No matching knowledge found.')).toBeInTheDocument();
});

it('opens details with a normal conversation link and shows only the recorded source quote', async () => {
  const detail = entry({
    text: 'Mira runs the inn and keeps the ledger.',
    evidence: [
      { id: 'turn-t1', kind: 'turn', label: 'Conversation', turnId: 't1', available: true },
      { id: 'evidence-0', kind: 'campaign_source', label: 'Notes (version 1)', available: true },
      { id: 'turn-t2', kind: 'turn', label: 'Old chat', turnId: 't2', available: false },
    ],
    history: [
      {
        at: '2026-01-01T00:00:00.000Z',
        kind: 'recorded',
        origin: 'gm',
        turnId: 't1',
        summary: 'Recorded',
      },
    ],
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) =>
      path.includes('/evidence/')
        ? reply({
            kind: 'campaign_source',
            label: 'x',
            quote: 'Mira keeps the ledger.',
            available: true,
          })
        : path.includes('/entries/e1')
          ? reply(detail)
          : reply(page([entry({})]))
    )
  );
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Details for Mira' }));
  const link = await screen.findByRole('link', { name: 'Conversation' });
  expect(link).toHaveAttribute('href', '/campaigns/c1?tab=play&turn=t1');
  expect(screen.getByText('Old chat (no longer available)')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Notes (version 1)' }));
  expect(await screen.findByText('Mira keeps the ledger.')).toBeInTheDocument();
});

it('shows a malformed Journal response as a retryable failure instead of breaking the page', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => reply([{ unrelated: true }]))
  );
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('incomplete Journal response');
  expect(screen.getByRole('button', { name: 'Retry knowledge load' })).toBeInTheDocument();
  expect(screen.getByLabelText('Search knowledge')).toBeInTheDocument();
});
