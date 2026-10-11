import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import GmIndex from '../src/features/journal/GmIndex';
import type { GmIndexStatus, MemoryRebuildJobView, Settings } from '../src/services/types';
import { fixtureCampaign, options as baseOptions } from './fixtures';

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const options: Settings = {
  ...baseOptions,
  gmIndex: {
    purposeId: 'gm_index',
    modes: [
      { id: 'prepare', label: 'Prepare GM index' },
      { id: 'fresh_rebuild', label: 'Rebuild index from scratch' },
    ],
    finalizationStages: [],
  },
  memoryRebuild: {
    actionOptions: [
      { id: 'apply', label: 'Apply' },
      { id: 'discard', label: 'Discard' },
      { id: 'resume', label: 'Retry' },
      { id: 'cancel', label: 'Cancel' },
    ],
  },
};
const preview = {
  topics: [{ title: 'Armor lead', text: 'A trader promised armor.' }],
  coverage: { turns: 5, sourceSections: 8, knowledge: 12 },
};
const status = (over: Partial<GmIndexStatus> = {}): GmIndexStatus => ({
  prepared: true,
  enabled: true,
  refreshRequired: false,
  canPrepare: true,
  blockedReason: null,
  playerKnown: preview,
  ...over,
});
const job = (over: Partial<MemoryRebuildJobView> = {}): MemoryRebuildJobView => ({
  id: 'job-1',
  campaignId: fixtureCampaign().id,
  purpose: 'gm_index',
  status: 'ready',
  statusLabel: 'Ready to review',
  active: false,
  processedTurns: 4,
  totalTurns: 4,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  errorCode: null,
  safeError: null,
  allowedActions: ['apply', 'discard'],
  baseline: null,
  candidate: {
    text: 'PRIVATE_RAW_CANDIDATE_MARKER',
    coveredTurnIds: [],
    proposalDigest: 'a'.repeat(64),
  },
  compact: null,
  decision: null,
  gmIndex: { mode: 'fresh_rebuild', preview },
  ...over,
});
const reply = (data: unknown, code = 200) =>
  new Response(JSON.stringify({ data }), { status: code });
type Handler = (path: string, init?: RequestInit) => Response | Promise<Response>;
function stub(handler: Handler) {
  const fetcher = vi.fn(async (path: string, init?: RequestInit) => handler(String(path), init));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
const page = (current: MemoryRebuildJobView | null) => ({
  jobs: current ? [current] : [],
  current,
  nextCursor: null,
});
const prepare = () => screen.getByRole('button', { name: 'Prepare GM index' });
const rebuild = () => screen.getByRole('button', { name: 'Rebuild index from scratch' });
const mount = (onChanged = vi.fn()) =>
  render(<GmIndex campaign={fixtureCampaign()} options={options} active onChanged={onChanged} />);

it('reviews only safe coverage and topics, then applies the reviewed digest', async () => {
  let current = job();
  let enabled = false;
  const onChanged = vi.fn();
  const fetcher = stub((path, init) => {
    if (path.endsWith('/gm-index')) return reply(status({ enabled }));
    if (path.includes('/memory/rebuilds?')) return reply(page(current));
    if (path.endsWith('/apply') && init?.method === 'POST') {
      enabled = true;
      current = job({
        status: 'applied',
        statusLabel: 'Applied',
        allowedActions: [],
        decision: { action: 'apply', requestId: 'apply-id', memoryId: null },
      });
      return reply({ campaign: fixtureCampaign(), job: current });
    }
    return reply(current);
  });
  mount(onChanged);
  expect(await screen.findByText('Armor lead')).toBeInTheDocument();
  expect(
    screen.getByText(/Checked 5 turns, 8 source sections and 12 knowledge records/)
  ).toBeInTheDocument();
  expect(screen.queryByText(/PRIVATE_RAW_CANDIDATE_MARKER/)).not.toBeInTheDocument();
  expect(rebuild()).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
  expect(screen.getByText(/Enabled: notes update before each turn finishes/)).toBeInTheDocument();
  const call = fetcher.mock.calls.find(
    ([path, init]) => path.endsWith('/apply') && init?.method === 'POST'
  )!;
  expect(JSON.parse(String(call[1]?.body))).toMatchObject({ proposalDigest: 'a'.repeat(64) });
});

it('reuses a fresh-rebuild request identity after a lost response and restores fresh review mode', async () => {
  let current: MemoryRebuildJobView | null = null;
  let attempts = 0;
  const bodies: Record<string, unknown>[] = [];
  stub((path, init) => {
    if (path.endsWith('/gm-index')) return reply(status());
    if (path.includes('/memory/rebuilds?')) return reply(page(current));
    if (path.endsWith('/memory/rebuilds') && init?.method === 'POST') {
      bodies.push(JSON.parse(String(init.body)));
      if (++attempts === 1) throw new TypeError('Lost preparation response');
      current = job();
      return reply(current, 202);
    }
    return reply(current);
  });
  mount();
  await waitFor(() => expect(rebuild()).toBeEnabled());
  fireEvent.click(rebuild());
  await screen.findByText(/Lost preparation response/);
  fireEvent.click(rebuild());
  await screen.findByText('Armor lead');
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toEqual(bodies[1]);
  expect(bodies[0]).toMatchObject({ purpose: 'gm_index', mode: 'fresh_rebuild' });
  expect(bodies[0]!.requestId).toMatch(/^[0-9a-f-]{36}$/);
});

it('failed rebuild retains the enabled status and offers recovery without exposing a candidate', async () => {
  const failed = job({
    status: 'failed',
    statusLabel: 'Failed',
    safeError: 'Synthetic quota failure',
    candidate: null,
    allowedActions: ['resume', 'discard'],
    gmIndex: { mode: 'fresh_rebuild', preview: null },
  });
  stub((path) => (path.endsWith('/gm-index') ? reply(status()) : reply(page(failed))));
  mount();
  await screen.findByText(/Synthetic quota failure/);
  expect(screen.getByText(/Enabled: notes update before each turn finishes/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument();
  expect(screen.queryByText('Armor lead')).not.toBeInTheDocument();
});

it('blocks competing preparation while a foreign job runs and discovers its completion', async () => {
  let current: MemoryRebuildJobView | null = job({
    purpose: 'compact_history',
    active: true,
    status: 'running',
    statusLabel: 'Rebuilding',
    candidate: null,
    allowedActions: ['cancel'],
    gmIndex: undefined,
  });
  stub((path) => {
    if (path.endsWith('/gm-index')) return reply(status());
    if (path.includes('/memory/rebuilds?')) return reply(page(current));
    const finished = job({
      purpose: 'compact_history',
      active: false,
      status: 'applied',
      allowedActions: [],
      candidate: null,
      gmIndex: undefined,
    });
    current = null;
    return reply(finished);
  });
  mount();
  await screen.findByText(/Another preparation is running/);
  expect(prepare()).toBeDisabled();
  expect(rebuild()).toBeDisabled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1100);
  });
  await waitFor(() => expect(rebuild()).toBeEnabled());
  expect(screen.queryByText(/Another preparation is running/)).not.toBeInTheDocument();
});

it('ignores a late status response after navigating to another campaign', async () => {
  const old = fixtureCampaign();
  const next = { ...fixtureCampaign(), id: 'next-campaign' };
  let resolve!: (response: Response) => void;
  const delayed = new Promise<Response>((done) => {
    resolve = done;
  });
  stub((path) => {
    if (path.includes('/memory/rebuilds?')) return reply(page(null));
    if (path.includes(next.id)) return reply(status({ prepared: false, enabled: false }));
    return delayed;
  });
  const view = render(<GmIndex campaign={old} options={options} active onChanged={vi.fn()} />);
  view.rerender(<GmIndex campaign={next} options={options} active onChanged={vi.fn()} />);
  await waitFor(() => expect(prepare()).toBeEnabled());
  await act(async () => {
    resolve(reply(status({ prepared: true, enabled: true })));
    await delayed;
  });
  expect(screen.getByText(/Not enabled/)).toBeInTheDocument();
  expect(screen.queryByText(/Enabled: notes update/)).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Rebuild index from scratch' })
  ).not.toBeInTheDocument();
});

it('restores its older reviewable GM job from purpose attention despite a newer memory job', async () => {
  const gm = job();
  const memory = job({
    id: 'newer-memory-job',
    purpose: 'memory',
    gmIndex: undefined,
    candidate: {
      text: 'Ordinary rebuilt memory',
      coveredTurnIds: [],
      proposalDigest: 'b'.repeat(64),
    },
  });
  stub((path) => {
    if (path.endsWith('/gm-index')) return reply(status());
    if (path.includes('/memory/rebuilds?'))
      return reply({
        jobs: [memory],
        current: memory,
        attentionByPurpose: [memory, gm],
        nextCursor: '1',
      });
    return reply(gm);
  });
  mount();
  await screen.findByText('Armor lead');
  expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
  expect(screen.queryByText(/Ordinary rebuilt memory/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Another preparation is running/)).not.toBeInTheDocument();
  expect(rebuild()).toBeDisabled();
});
