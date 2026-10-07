import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import HistoryMemory from '../src/features/journal/HistoryMemory';
import type {
  HistoryPage,
  HistoryStatus,
  MemoryRebuildJobView,
  Settings,
} from '../src/services/types';
import { fixtureCampaign, options as baseOptions } from './fixtures';

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const options: Settings = {
  ...baseOptions,
  history: {
    kindOptions: [
      { id: 'section', label: 'Section' },
      { id: 'chapter', label: 'Chapter' },
    ],
    reasonOptions: [{ id: 'searchable_only', label: 'Searchable only' }],
    limits: { pageSizeDefault: 20, originalsPageSize: 4, queryMaxChars: 200 },
  },
  memoryRebuild: { actionOptions: [{ id: 'apply', label: 'Apply' }] },
};
const status = (over: Partial<HistoryStatus> = {}): HistoryStatus => ({
  enabled: true,
  activeOverviewId: 'o1',
  protectedKnowledgeIds: [],
  protectedSectionIds: [],
  protectedMemoryIds: [],
  coveredTurns: 8,
  totalTurns: 11,
  searchableSections: 1,
  pendingRefresh: false,
  unavailableProtectedIds: [],
  diagnostics: {
    targetBytes: 16384,
    suppliedBytes: 900,
    mandatoryBytes: 300,
    overflowBytes: 0,
    included: [],
    omitted: { count: 3, reasonCounts: { searchable_only: 3 } },
  },
  ...over,
});
const page = (over: Partial<HistoryPage> = {}): HistoryPage => ({
  items: [
    {
      id: 'f1',
      title: 'The arena',
      kind: 'section',
      sourceTurnIds: ['t1'],
      startAt: null,
      endAt: null,
      excerpt: 'A fight in the arena.',
      protected: false,
      available: true,
    },
  ],
  nextCursor: null,
  status: status(),
  ...over,
});
const reply = (data: unknown, code = 200) =>
  new Response(JSON.stringify(code === 200 || code === 202 ? { data } : { detail: String(data) }), {
    status: code,
  });
const job = (over: Partial<MemoryRebuildJobView> = {}): MemoryRebuildJobView => ({
  id: 'j1',
  campaignId: 'c1',
  purpose: 'compact_history',
  status: 'ready',
  statusLabel: 'Ready to review',
  active: false,
  processedTurns: 4,
  totalTurns: 4,
  createdAt: '',
  updatedAt: '',
  errorCode: null,
  safeError: null,
  allowedActions: ['apply', 'discard'],
  baseline: null,
  candidate: {
    text: '- Overview text',
    coveredTurnIds: ['a', 'b'],
    proposalDigest: 'd'.repeat(64),
  },
  compact: { sections: 2, chapters: 1 },
  decision: null,
  ...over,
});
type Handler = (path: string, init?: RequestInit) => Response | Promise<Response>;
function stub(handler: Handler, current: MemoryRebuildJobView | null = null) {
  const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    const url = String(path);
    if (url.includes('/memory/rebuilds?')) return reply({ jobs: [], current, nextCursor: null });
    return handler(url, init);
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
const calls = (f: ReturnType<typeof stub>, method: string, part: string) =>
  f.mock.calls.filter(
    ([path, init]) =>
      String(path).includes(part) && ((init as RequestInit)?.method ?? 'GET') === method
  );
const body = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));
const mount = (onChanged = vi.fn(), campaign = fixtureCampaign()) =>
  render(<HistoryMemory campaign={campaign} options={options} onChanged={onChanged} />);

it('shows what is searchable, what is supplied and why items were omitted', async () => {
  stub(() => reply(page()));
  mount();
  await screen.findByText('The arena');
  expect(screen.getByText(/Selective history is on\./)).toBeInTheDocument();
  expect(screen.getByText(/cover 8 of 11 turns/)).toBeInTheDocument();
  expect(screen.getByText(/Searchable only: 3/)).toBeInTheDocument();
  expect(screen.queryByText(/exceeds the soft target/)).not.toBeInTheDocument();
});

it('reports protected overflow without hiding the protected items', async () => {
  stub(() =>
    reply(
      page({
        status: status({
          diagnostics: { ...status().diagnostics, overflowBytes: 2048, suppliedBytes: 18432 },
        }),
      })
    )
  );
  mount();
  await screen.findByText(/exceeds the soft target by 2048 bytes/);
});

it('searches through the server and pages with the opaque cursor', async () => {
  const fetcher = stub((path) => {
    if (path.includes('cursor=next-1'))
      return reply(page({ items: [{ ...page().items[0]!, id: 'f2', title: 'The cellar' }] }));
    if (path.includes('query=arena')) return reply(page());
    return reply(page({ nextCursor: 'next-1' }));
  });
  mount();
  await screen.findByText('The arena');
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
  await screen.findByText('The cellar');
  expect(screen.getByText('The arena')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'arena' } });
  await waitFor(() => expect(calls(fetcher, 'GET', 'query=arena').length).toBeGreaterThan(0));
  await waitFor(() => expect(screen.queryByText('The cellar')).not.toBeInTheDocument());
});

it('reads exact originals only when asked', async () => {
  const fetcher = stub((path) =>
    path.includes('/history/f1')
      ? reply({
          item: { id: 'f1', title: 'The arena', kind: 'section', text: 't', protected: false },
          originals: [
            { turnId: 't1', player: 'enter the arena', gm: 'The crowd roars.', createdAt: '' },
          ],
          nextCursor: null,
          correctionGuidance: { instruction: '', items: [] },
        })
      : reply(page())
  );
  mount();
  await screen.findByText('The arena');
  expect(calls(fetcher, 'GET', '/history/f1')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Show originals' }));
  await screen.findByText('The crowd roars.');
  fireEvent.click(screen.getByRole('button', { name: 'Hide originals' }));
  expect(screen.queryByText('The crowd roars.')).not.toBeInTheDocument();
});

it('protects a section once per click burst and reuses the identity after a lost response', async () => {
  let attempts = 0;
  const fetcher = stub((path, init) => {
    if (init?.method === 'PATCH') {
      attempts++;
      if (attempts === 1) throw new TypeError('network lost');
      return reply({ status: status({ protectedSectionIds: ['f1'] }) });
    }
    return reply(page());
  });
  mount();
  await screen.findByText('The arena');
  const protect = () => screen.getByRole('button', { name: 'Protect' });
  fireEvent.click(protect());
  fireEvent.click(protect());
  await screen.findByText(/network lost/);
  fireEvent.click(protect());
  await waitFor(() => expect(calls(fetcher, 'PATCH', '/protection/sections/f1')).toHaveLength(2));
  const patches = calls(fetcher, 'PATCH', '/protection/sections/f1');
  expect(body(patches[0]!).requestId).toBe(body(patches[1]!).requestId);
  expect(body(patches[0]!)).toMatchObject({ expected: false, protected: true });
});

it('prepares, reviews and activates only on request, offering to protect the manual memory', async () => {
  const campaign = fixtureCampaign();
  campaign.memory = {
    id: 'm1',
    text: 'Facts only in memory.',
    valid: true,
    coveredTurnIds: [],
    createdAt: '',
  };
  const onChanged = vi.fn();
  const fetcher = stub((path, init) => {
    if (path.endsWith('/memory/rebuilds') && init?.method === 'POST')
      return reply(
        job({ status: 'running', statusLabel: 'Rebuilding', active: true, candidate: null }),
        202
      );
    if (path.includes('/memory/rebuilds/j1') && !path.includes('apply')) return reply(job());
    if (path.endsWith('/apply'))
      return reply({
        campaign: {},
        job: job({
          status: 'applied',
          statusLabel: 'Applied',
          allowedActions: [],
          candidate: null,
        }),
      });
    return reply(page({ status: status({ enabled: false }) }));
  });
  mount(onChanged, campaign);
  await screen.findByText(/Selective history is off/);
  expect(calls(fetcher, 'POST', '/memory/rebuilds')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Prepare compact history' }));
  expect(await screen.findByText(/Rebuilding: step/)).toBeInTheDocument();
  expect(body(calls(fetcher, 'POST', '/memory/rebuilds')[0]!).purpose).toBe('compact_history');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1100);
  });
  await screen.findByText('Review before activating');
  expect(screen.getByText('Overview text')).toBeInTheDocument();
  expect(screen.getByText('Facts only in memory.')).toBeInTheDocument();
  expect(screen.getByText(/2 sections and 1 chapters were prepared/)).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText(/Also protect this memory text exactly/));
  fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
  await waitFor(() => expect(calls(fetcher, 'POST', '/apply')).toHaveLength(1));
  expect(body(calls(fetcher, 'POST', '/apply')[0]!)).toMatchObject({
    proposalDigest: 'd'.repeat(64),
    preserveMemory: true,
  });
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
});

it('turns selective history off only after confirmation', async () => {
  const fetcher = stub((_path, init) =>
    init?.method === 'PATCH' ? reply({ status: status({ enabled: false }) }) : reply(page())
  );
  const confirmSpy = vi
    .spyOn(window, 'confirm')
    .mockReturnValueOnce(false)
    .mockReturnValueOnce(true);
  mount();
  await screen.findByText('The arena');
  const off = screen.getByRole('button', { name: 'Turn off selective history' });
  fireEvent.click(off);
  expect(calls(fetcher, 'PATCH', '/history/settings')).toHaveLength(0);
  fireEvent.click(off);
  await waitFor(() => expect(calls(fetcher, 'PATCH', '/history/settings')).toHaveLength(1));
  expect(body(calls(fetcher, 'PATCH', '/history/settings')[0]!)).toMatchObject({
    enabled: false,
    expectedEnabled: true,
  });
  expect(confirmSpy).toHaveBeenCalledTimes(2);
});

it('does not start preparation by itself and ignores a late page for another campaign', async () => {
  let release!: (response: Response) => void;
  const fetcher = stub(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      })
  );
  const view = mount();
  view.rerender(
    <HistoryMemory campaign={{ ...fixtureCampaign(), id: 'other' }} options={options} />
  );
  await act(async () => {
    release(reply(page()));
  });
  expect(calls(fetcher, 'POST', '/memory/rebuilds')).toHaveLength(0);
});
