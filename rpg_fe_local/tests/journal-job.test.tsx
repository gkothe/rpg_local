import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import JournalKnowledge from '../src/features/journal/JournalKnowledge';
import Journal from '../src/features/journal/Journal';
import type { JournalJobView, JournalPage } from '../src/services/types';
import { fixtureCampaign, options } from './fixtures';

// History recall has its own tests; these cover the Journal behavior around it.
vi.mock('../src/features/journal/HistoryMemory', () => ({ default: () => null }));

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const emptyPage: JournalPage = { entries: [], groups: [], total: 0, nextCursor: null };
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(status === 200 ? { data } : { detail: String(data) }), { status });
const job = (over: Partial<JournalJobView> = {}): JournalJobView => ({
  id: 'job-1',
  kind: 'backfill',
  status: 'running',
  statusLabel: 'Working',
  active: true,
  progress: { processedPairs: 0, eligiblePairs: 5, created: 0, skipped: 0 },
  error: null,
  finding: null,
  decision: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});
type Handler = (path: string, init?: RequestInit) => Response | Promise<Response>;
function stub(handler: Handler) {
  const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.includes('/journal/entries')) return reply(emptyPage);
    return handler(path, init);
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
const posts = (fetcher: ReturnType<typeof stub>, suffix: string) =>
  fetcher.mock.calls.filter(
    ([path, init]) => String(path).endsWith(suffix) && (init as RequestInit)?.method === 'POST'
  );
const body = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));
const mount = (onChanged = vi.fn(), campaignId = 'c1') =>
  render(
    <MemoryRouter>
      <JournalKnowledge
        campaignId={campaignId}
        revision={1}
        options={options}
        onChanged={onChanged}
      />
    </MemoryRouter>
  );
const open = () =>
  fireEvent.click(screen.getByText('Fill from past conversations', { selector: 'summary' }));
const startButton = () => screen.getByRole('button', { name: 'Fill from past conversations' });

it('explains the cost, starts only on request and uses one guarded request per click burst', async () => {
  const fetcher = stub(() => reply(job()));
  mount();
  open();
  expect(screen.getByText(/uses your provider allowance/)).toBeInTheDocument();
  expect(posts(fetcher, '/backfills')).toHaveLength(0);
  fireEvent.click(startButton());
  fireEvent.click(startButton());
  fireEvent.click(startButton());
  await screen.findByText(/Working: 0 of 5 conversations checked/);
  expect(posts(fetcher, '/backfills')).toHaveLength(1);
  expect(body(posts(fetcher, '/backfills')[0]!).requestId).toMatch(/^[0-9a-f-]{36}$/);
  // Progress never claims a percentage while inference is pending.
  expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  expect(startButton()).toBeDisabled();
});

it('polls sequentially, then refreshes canonical data once after confirmed completion', async () => {
  let reads = 0;
  const fetcher = stub((path, init) => {
    if (init?.method === 'POST') return reply(job());
    reads++;
    return reply(
      reads < 2
        ? job({ progress: { processedPairs: 3, eligiblePairs: 5, created: 1, skipped: 0 } })
        : job({
            status: 'completed',
            statusLabel: 'Finished',
            active: false,
            progress: { processedPairs: 5, eligiblePairs: 5, created: 2, skipped: 1 },
          })
    );
  });
  const onChanged = vi.fn();
  mount(onChanged);
  open();
  fireEvent.click(startButton());
  await screen.findByText(/Working: 0 of 5/);
  expect(onChanged).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(1000));
  await screen.findByText(/Working: 3 of 5 conversations checked · 1 found/);
  expect(fetcher.mock.calls.filter(([p]) => String(p).includes('/jobs/job-1'))).toHaveLength(1);
  await act(() => vi.advanceTimersByTimeAsync(1000));
  await screen.findByText(/Finished: 2 added, 1 skipped\./);
  expect(onChanged).toHaveBeenCalledTimes(1);
  // No further polling once finished.
  const settled = fetcher.mock.calls.length;
  await act(() => vi.advanceTimersByTimeAsync(5000));
  expect(fetcher.mock.calls.length).toBe(settled);
});

it('keeps the request identity after an uncertain answer and replaces it after a definite refusal', async () => {
  let attempt = 0;
  const fetcher = stub((_path, init) => {
    if (init?.method !== 'POST') return reply(job());
    attempt++;
    if (attempt === 1) throw new TypeError('network down');
    if (attempt === 2) return reply('A Journal task is already running', 409 as never);
    return reply(job());
  });
  mount();
  open();
  fireEvent.click(startButton());
  await screen.findByRole('alert');
  fireEvent.click(startButton());
  await waitFor(() => expect(posts(fetcher, '/backfills')).toHaveLength(2));
  const [first, second] = posts(fetcher, '/backfills').map((c) => body(c).requestId);
  expect(second).toBe(first);
  await waitFor(() => expect(startButton()).not.toBeDisabled());
  fireEvent.click(startButton());
  await waitFor(() => expect(posts(fetcher, '/backfills')).toHaveLength(3));
  expect(body(posts(fetcher, '/backfills')[2]!).requestId).not.toBe(first);
});

it('cancels a running task and retries an interrupted one', async () => {
  let state: JournalJobView = job();
  const fetcher = stub((path, init) => {
    if (path.endsWith('/cancel'))
      return reply((state = job({ status: 'cancelled', statusLabel: 'Cancelled', active: false })));
    if (path.endsWith('/retry')) return reply((state = job()));
    if (init?.method === 'POST') return reply(state);
    return reply(state);
  });
  mount();
  open();
  fireEvent.click(startButton());
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
  await screen.findByText(/Cancelled/);
  expect(posts(fetcher, '/cancel')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  expect(startButton()).not.toBeDisabled();

  state = job({
    status: 'interrupted',
    statusLabel: 'Interrupted',
    active: false,
    error: { code: 'journal_interrupted', message: 'The app restarted; retry it.' },
  });
  fireEvent.click(startButton());
  const retry = await screen.findByRole('button', { name: 'Retry task' });
  expect(screen.getByRole('alert')).toHaveTextContent('The app restarted; retry it.');
  fireEvent.click(retry);
  await screen.findByText(/Working/);
  expect(posts(fetcher, '/retry')).toHaveLength(1);
});

it('ignores a late answer after navigating to another campaign', async () => {
  let release!: (response: Response) => void;
  stub((_path, init) =>
    init?.method === 'POST'
      ? new Promise<Response>((resolve) => {
          release = resolve;
        })
      : reply(job())
  );
  const onChanged = vi.fn();
  const view = mount(onChanged);
  open();
  fireEvent.click(startButton());
  await waitFor(() => expect(release).toBeDefined());
  view.rerender(
    <MemoryRouter>
      <JournalKnowledge campaignId="c2" revision={1} options={options} onChanged={onChanged} />
    </MemoryRouter>
  );
  await act(async () => {
    release(reply(job({ status: 'completed', statusLabel: 'Finished', active: false })));
  });
  expect(screen.queryByText(/Finished/)).not.toBeInTheDocument();
  expect(onChanged).not.toHaveBeenCalled();
});

it('leaves unsaved notes untouched while a task runs and progresses', async () => {
  stub((_path, init) =>
    reply(
      init?.method === 'POST'
        ? job()
        : job({ progress: { processedPairs: 2, eligiblePairs: 5, created: 0, skipped: 0 } })
    )
  );
  render(
    <MemoryRouter>
      <Journal campaign={fixtureCampaign()} options={options} onSaved={async () => {}} />
    </MemoryRouter>
  );
  const notes = screen.getAllByRole('textbox')[0]!;
  fireEvent.change(notes, { target: { value: 'my unsaved draft' } });
  fireEvent.click(screen.getByRole('tab', { name: 'Campaign knowledge' }));
  open();
  fireEvent.click(startButton());
  await screen.findByText(/Working: 0 of 5/);
  await act(() => vi.advanceTimersByTimeAsync(1000));
  await screen.findByText(/Working: 2 of 5/);
  expect(notes).toHaveValue('my unsaved draft');
});
