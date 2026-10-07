import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MemoryRebuild from '../src/features/journal/MemoryRebuild';
import type { MemoryRebuildJobView, MemoryRebuildPage, Settings } from '../src/services/types';
import { options as baseOptions } from './fixtures';

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const options: Settings = {
  ...baseOptions,
  memoryRebuild: {
    actionOptions: [
      { id: 'cancel', label: 'Cancel' },
      { id: 'resume', label: 'Retry' },
      { id: 'apply', label: 'Apply' },
      { id: 'discard', label: 'Discard' },
    ],
  },
};
const DIGEST = 'a'.repeat(64);
const reply = (data: unknown, status = 200) =>
  new Response(
    JSON.stringify(status === 200 || status === 202 ? { data } : { detail: String(data) }),
    {
      status,
    }
  );
const job = (over: Partial<MemoryRebuildJobView> = {}): MemoryRebuildJobView => ({
  id: 'job-1',
  campaignId: 'c1',
  status: 'running',
  statusLabel: 'Rebuilding',
  active: true,
  processedTurns: 1,
  totalTurns: 4,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  errorCode: null,
  safeError: null,
  allowedActions: ['cancel'],
  baseline: { id: 'm0', text: 'Old summary', coveredTurnIds: [], valid: true },
  candidate: null,
  decision: null,
  ...over,
});
const ready = (): MemoryRebuildJobView =>
  job({
    status: 'ready',
    statusLabel: 'Ready to review',
    active: false,
    processedTurns: 4,
    allowedActions: ['apply', 'discard'],
    candidate: { text: '- Rebuilt summary', coveredTurnIds: ['t1', 't2'], proposalDigest: DIGEST },
  });
const page = (current: MemoryRebuildJobView | null): MemoryRebuildPage => ({
  jobs: current ? [current] : [],
  current,
  nextCursor: null,
});
type Handler = (path: string, init?: RequestInit) => Response | Promise<Response>;
function stub(handler: Handler, initial: MemoryRebuildJobView | null = null) {
  const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    if (String(path).includes('/memory/rebuilds?')) return reply(page(initial));
    return handler(String(path), init);
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
const posts = (fetcher: ReturnType<typeof stub>, suffix: string) =>
  fetcher.mock.calls.filter(
    ([path, init]) => String(path).endsWith(suffix) && (init as RequestInit)?.method === 'POST'
  );
const body = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));
const mount = (campaignId = 'c1', onApplied = vi.fn()) =>
  render(<MemoryRebuild campaignId={campaignId} options={options} onApplied={onApplied} />);
const startButton = () => screen.getByRole('button', { name: 'Rebuild memory' });

it('explains the cost, starts only on request and uses one guarded request per click burst', async () => {
  const fetcher = stub(() => reply(job(), 202));
  mount();
  expect(screen.getByText(/using your provider allowance/)).toBeInTheDocument();
  await waitFor(() => expect(startButton()).toBeEnabled());
  expect(posts(fetcher, '/memory/rebuilds')).toHaveLength(0);
  fireEvent.click(startButton());
  fireEvent.click(startButton());
  await screen.findByText(/Rebuilding: 1 of 4 turns summarized/);
  expect(posts(fetcher, '/memory/rebuilds')).toHaveLength(1);
  expect(body(posts(fetcher, '/memory/rebuilds')[0]!).requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(startButton()).toBeDisabled();
});

it('reuses the request identity after an uncertain acknowledgement', async () => {
  let attempts = 0;
  const fetcher = stub(() => {
    attempts++;
    if (attempts === 1) throw new TypeError('network lost');
    return reply(job(), 202);
  });
  mount();
  await waitFor(() => expect(startButton()).toBeEnabled());
  fireEvent.click(startButton());
  await screen.findByText(/network lost/);
  fireEvent.click(startButton());
  await screen.findByText(/Rebuilding/);
  const calls = posts(fetcher, '/memory/rebuilds');
  expect(calls).toHaveLength(2);
  expect(body(calls[0]!).requestId).toBe(body(calls[1]!).requestId);
});

it('restores a ready draft on reload and shows the captured baseline beside the candidate', async () => {
  stub(() => reply(ready()), ready());
  mount();
  await screen.findByText('Ready to review');
  expect(screen.getByText('Old summary')).toBeInTheDocument();
  expect(screen.getByText('Rebuilt summary')).toBeInTheDocument();
  expect(screen.getByText('Covers 2 turns.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
});

it('polls sequentially to a draft; apply posts the reviewed digest then refreshes the campaign once', async () => {
  let reads = 0;
  const applied = job({
    status: 'applied',
    statusLabel: 'Applied',
    active: false,
    allowedActions: [],
    candidate: ready().candidate,
    decision: { action: 'apply', requestId: 'r', memoryId: 'm1' },
  });
  const fetcher = stub((path, init) => {
    if (path.endsWith('/apply')) return reply({ campaign: {}, job: applied });
    if (init?.method === 'POST') return reply(job(), 202);
    reads++;
    return reply(reads < 2 ? job({ processedTurns: 2 }) : ready());
  });
  const onApplied = vi.fn();
  mount('c1', onApplied);
  await waitFor(() => expect(startButton()).toBeEnabled());
  fireEvent.click(startButton());
  await screen.findByText(/Rebuilding: 1 of 4/);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1100);
  });
  await screen.findByText(/Rebuilding: 2 of 4/);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1100);
  });
  await screen.findByText('Ready to review');
  expect(onApplied).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
  const call = posts(fetcher, '/apply')[0]!;
  expect(body(call).proposalDigest).toBe(DIGEST);
  await screen.findByText('Applied');
  expect(startButton()).toBeEnabled();
});

it('shows a stale-draft rejection and keeps the draft for review', async () => {
  const fetcher = stub(() => reply('The story changed after this draft was made', 409), ready());
  mount();
  await screen.findByText('Ready to review');
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await screen.findByText(/The story changed after this draft was made/);
  expect(posts(fetcher, '/apply')).toHaveLength(1);
  expect(screen.getByText('Rebuilt summary')).toBeInTheDocument();
});

it('ignores a late answer after navigating to another campaign and applies nothing on unmount', async () => {
  let release!: (response: Response) => void;
  const fetcher = stub(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      })
  );
  const view = mount('c1');
  await waitFor(() => expect(startButton()).toBeEnabled());
  fireEvent.click(startButton());
  view.rerender(<MemoryRebuild campaignId="c2" options={options} />);
  await act(async () => {
    release(reply(job({ campaignId: 'c1' }), 202));
  });
  expect(screen.queryByText(/Rebuilding/)).not.toBeInTheDocument();
  view.unmount();
  expect(posts(fetcher, '/apply')).toHaveLength(0);
});

it('recognizes a compact-history job without offering ordinary memory Apply', async () => {
  const compact = { ...ready(), purpose: 'compact_history', status: 'running', active: true };
  stub(() => reply(compact), compact);
  mount();
  await screen.findByText(/compact history task is running/);
  expect(screen.getByRole('button', { name: 'Rebuild memory' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument();
});

it('still restores a legacy memory draft that has no purpose field', async () => {
  stub(() => reply(ready()), ready());
  mount();
  await screen.findByText('Ready to review');
  expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
});
