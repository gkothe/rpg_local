import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import NpcSheetCompletion from '../src/features/characters/NpcSheetCompletion';
import type { NpcSheetCompletionView } from '../src/services/types';

afterEach(() => vi.unstubAllGlobals());
const ready: NpcSheetCompletionView = {
  id: 'job',
  status: 'ready',
  active: false,
  canStart: false,
  error: null,
  basis: 'model_knowledge',
  systemName: 'Skill game',
  conflicts: [],
  additions: [{ path: ['attributes', 'skills', 'Lore'], value: 2 }],
  actions: [
    { id: 'apply', label: 'Apply', decision: true },
    { id: 'discard', label: 'Discard', decision: true },
  ],
};
const reply = (data: unknown) => new Response(JSON.stringify({ data }));
it('reviews additions on reload and applies only on explicit action', async () => {
  const saved = vi.fn(async () => {});
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) =>
    reply(
      init?.method === 'POST' ? { ...ready, status: 'applied', canStart: true, actions: [] } : ready
    )
  );
  vi.stubGlobal('fetch', fetcher);
  render(<NpcSheetCompletion campaignId="c" characterId="n" enabled onSaved={saved} />);
  expect(await screen.findByText('attributes → skills → Lore')).toBeVisible();
  expect(screen.getByText(/Provisional mechanics/)).toBeVisible();
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  fireEvent.click(screen.getByText('Apply'));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  const decision = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(decision[0]).toContain('/job/decisions');
  expect(JSON.parse(String(decision[1]!.body)).decision).toBe('apply');
});
it('retains the same start identity after an uncertain response and guards double clicks', async () => {
  const bodies: string[] = [];
  let current: NpcSheetCompletionView | null = null;
  let release!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method) return reply(current);
      bodies.push(String(init.body));
      if (bodies.length === 1) throw new Error('Connection lost');
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    })
  );
  render(<NpcSheetCompletion campaignId="c" characterId="n" enabled onSaved={async () => {}} />);
  fireEvent.click(await screen.findByText('Complete sheet'));
  await screen.findByText('Connection lost');
  const button = screen.getByText('Complete sheet');
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1]).toBe(bodies[0]);
  current = ready;
  release(reply(ready));
  expect(await screen.findByText('Apply')).toBeVisible();
});
it('renders conflicts as text and omits Apply when the server does not offer it', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      reply({
        ...ready,
        conflicts: ['<script>Established stats conflict</script>'],
        actions: [ready.actions[1]],
      })
    )
  );
  render(<NpcSheetCompletion campaignId="c" characterId="n" enabled onSaved={async () => {}} />);
  expect(await screen.findByText('<script>Established stats conflict</script>')).toBeVisible();
  expect(screen.queryByText('Apply')).toBeNull();
  expect(document.querySelector('script')).toBeNull();
});
