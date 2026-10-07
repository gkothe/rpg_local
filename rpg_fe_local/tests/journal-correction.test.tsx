import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import JournalKnowledge from '../src/features/journal/JournalKnowledge';
import type { JournalEntry, JournalJobView, JournalPage } from '../src/services/types';
import { options } from './fixtures';

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const entry: JournalEntry = {
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
  updatedAt: '2026-01-01T00:00:00.000Z',
  connections: [],
  text: 'Mira is the innkeeper.',
  evidence: [],
  history: [],
};
const page: JournalPage = {
  entries: [entry],
  groups: [{ id: 'people_places', label: 'People and places', count: 1 }],
  total: 1,
  nextCursor: null,
};
const job = (over: Partial<JournalJobView> = {}): JournalJobView => ({
  id: 'job-1',
  kind: 'check',
  status: 'running',
  statusLabel: 'Working',
  active: true,
  progress: { processedPairs: 0, eligiblePairs: 2, created: null, skipped: null },
  error: null,
  finding: null,
  decision: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});
const proposed = job({
  status: 'completed',
  statusLabel: 'Finished',
  active: false,
  finding: {
    outcome: 'proposed',
    outcomeLabel: 'Correction proposed',
    reason: 'She says so herself.',
    knowledgeId: 'e1',
    proposalDigest: 'd'.repeat(64),
    changes: [
      {
        field: 'text',
        label: 'Text',
        before: 'Mira is the innkeeper.',
        after: 'Mira is a sister.',
      },
    ],
    evidence: [{ turnId: 't9', field: 'narrative', quote: 'a sister of the temple' }],
  },
});
const inconclusive = job({
  status: 'completed',
  statusLabel: 'Finished',
  active: false,
  finding: {
    outcome: 'inconclusive',
    outcomeLabel: 'Evidence is inconclusive',
    reason: 'Conflicting statements.',
    knowledgeId: 'e1',
    proposalDigest: null,
    changes: [],
    evidence: [],
  },
});
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(status === 200 ? { data } : { detail: String(data) }), { status });
type Handler = (path: string, init?: RequestInit) => Response | Promise<Response>;
function stub(handler: Handler) {
  const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.includes('/journal/entries?')) return reply(page);
    if (/\/journal\/entries\/e1$/.test(path)) return reply(entry);
    return handler(path, init);
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
const posts = (f: ReturnType<typeof stub>, suffix: string) =>
  f.mock.calls.filter(
    ([p, i]) => String(p).endsWith(suffix) && (i as RequestInit)?.method === 'POST'
  );
const body = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));
async function openFlag(onChanged = vi.fn()) {
  render(
    <MemoryRouter>
      <JournalKnowledge campaignId="c1" revision={1} options={options} onChanged={onChanged} />
    </MemoryRouter>
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Details for Mira' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Flag a mistake' }));
  return onChanged;
}
const explain = (text: string) =>
  fireEvent.change(screen.getByLabelText('What looks wrong?'), { target: { value: text } });

it('requires an explanation, checks without changing anything and keeps the draft while polling', async () => {
  const f = stub((_p, init) => (init?.method === 'POST' ? reply(job()) : reply(proposed)));
  await openFlag();
  const check = screen.getByRole('button', { name: 'Check this fact' });
  expect(check).toBeDisabled();
  explain('She is a sister, not an innkeeper.');
  expect(
    screen.getByText(/Nothing changes until you accept a proposed correction/)
  ).toBeInTheDocument();
  fireEvent.click(check);
  await screen.findByText(/Working/);
  expect(body(posts(f, '/checks')[0]!)).toMatchObject({
    explanation: 'She is a sister, not an innkeeper.',
  });
  // The explanation draft survives progress updates and cannot be edited mid-run.
  expect(screen.getByLabelText('What looks wrong?')).toHaveValue(
    'She is a sister, not an innkeeper.'
  );
  await act(() => vi.advanceTimersByTimeAsync(1000));
  const finding = await screen.findByRole('region', { name: 'Finding' });
  expect(within(finding).getByText('Correction proposed')).toBeInTheDocument();
  expect(within(finding).getByText('Mira is a sister.')).toBeInTheDocument();
  expect(within(finding).getByText(/a sister of the temple/)).toBeInTheDocument();
  expect(within(finding).getByRole('link', { name: 'Open conversation' })).toHaveAttribute(
    'href',
    '/campaigns/c1?tab=play&turn=t9'
  );
  expect(screen.getByLabelText('What looks wrong?')).toHaveValue(
    'She is a sister, not an innkeeper.'
  );
  expect(posts(f, '/accept')).toHaveLength(0);
});

it('accepts with the proposal digest, refreshes after the confirmed commit and then closes the finding', async () => {
  const f = stub((p, init) =>
    p.endsWith('/accept')
      ? reply({ decision: 'accepted', entry })
      : init?.method === 'POST'
        ? reply(proposed)
        : reply(proposed)
  );
  const onChanged = await openFlag();
  explain('wrong employer');
  fireEvent.click(screen.getByRole('button', { name: 'Check this fact' }));
  const accept = await screen.findByRole('button', { name: 'Accept correction' });
  expect(
    screen.getByText(/undoing a turn this correction relies on is blocked/)
  ).toBeInTheDocument();
  expect(onChanged).not.toHaveBeenCalled();
  fireEvent.click(accept);
  await screen.findByText('Correction accepted.');
  expect(body(posts(f, '/accept')[0]!)).toMatchObject({ proposalDigest: 'd'.repeat(64) });
  expect(onChanged).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'Accept correction' })).not.toBeInTheDocument();
});

it('offers no accept control for unchanged or inconclusive findings and dismiss changes nothing', async () => {
  const f = stub((p, init) =>
    p.endsWith('/dismiss')
      ? reply({ decision: 'dismissed' })
      : init?.method === 'POST'
        ? reply(inconclusive)
        : reply(inconclusive)
  );
  const onChanged = await openFlag();
  explain('wrong employer');
  fireEvent.click(screen.getByRole('button', { name: 'Check this fact' }));
  await screen.findByText('Conflicting statements.');
  expect(screen.queryByRole('button', { name: 'Accept correction' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await screen.findByText('Finding dismissed.');
  expect(posts(f, '/dismiss')).toHaveLength(1);
  expect(onChanged).not.toHaveBeenCalled();
});

it('replays an uncertain acceptance with the same request identity and surfaces refusals', async () => {
  let attempt = 0;
  const f = stub((p, init) => {
    if (p.endsWith('/accept')) {
      attempt++;
      if (attempt === 1) throw new TypeError('connection lost');
      if (attempt === 2) return reply({ decision: 'accepted', entry });
      return reply('The recorded fact changed after this check; run the check again', 409);
    }
    return init?.method === 'POST' ? reply(proposed) : reply(proposed);
  });
  const onChanged = await openFlag();
  explain('wrong employer');
  fireEvent.click(screen.getByRole('button', { name: 'Check this fact' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Accept correction' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Accept correction' }));
  await screen.findByText('Correction accepted.');
  const [first, second] = posts(f, '/accept').map((c) => body(c).requestId);
  expect(second).toBe(first);
  expect(onChanged).toHaveBeenCalledTimes(1);
});

it('shows a stale-target refusal without discarding the finding or the draft', async () => {
  stub((p, init) =>
    p.endsWith('/accept')
      ? reply('The recorded fact changed after this check; run the check again', 409)
      : init?.method === 'POST'
        ? reply(proposed)
        : reply(proposed)
  );
  await openFlag();
  explain('keep this draft');
  fireEvent.click(screen.getByRole('button', { name: 'Check this fact' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Accept correction' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('run the check again');
  expect(screen.getByLabelText('What looks wrong?')).toHaveValue('keep this draft');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Accept correction' })).not.toBeDisabled()
  );
});
