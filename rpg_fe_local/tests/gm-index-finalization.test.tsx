import { afterEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useTurn } from '../src/features/play/useTurn';
import PlayPage from '../src/pages/Play';
import type { Turn } from '../src/services/types';
import { fixtureCampaign, fixtureTurn, options, providers } from './fixtures';

afterEach(() => vi.unstubAllGlobals());
const pending = (): Turn => ({
  ...fixtureTurn(),
  status: 'failed',
  narrative: null,
  changes: [],
  rollInterpretations: undefined,
  ruleCitations: undefined,
  operationExplanations: undefined,
  editingPending: true,
  editingResume: { available: true, reason: null },
  finalization: { stage: 'index_updating', resume: { available: true, reason: null } },
});
const reply = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status });

it('blocks a new action and retains the modern finalization endpoint and request ID after a lost acknowledgement', async () => {
  const turn = pending();
  const campaign = { ...fixtureCampaign(), turns: [turn] };
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('Lost finalization acknowledgement'))
    .mockResolvedValueOnce(reply({ ...turn, status: 'running' }, 202));
  vi.stubGlobal('fetch', fetcher);
  const { result, unmount } = renderHook(() => useTurn(campaign, vi.fn(), options));
  expect(result.current.editingBlocked).toBe(true);
  await act(async () => {
    expect(await result.current.send('Different action', campaign.settings)).toBe(false);
  });
  expect(fetcher).not.toHaveBeenCalled();
  await act(async () => {
    expect(await result.current.resumeEditing(turn)).toBe(false);
  });
  expect(result.current.uncertainEditingResume).toBe(true);
  await act(async () => {
    expect(await result.current.resumeEditing()).toBe(true);
  });
  expect(fetcher.mock.calls[0][0]).toContain('/resume-finalization');
  expect(fetcher.mock.calls[1][0]).toBe(fetcher.mock.calls[0][0]);
  expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[0][1].body);
  unmount();
});

it('Play shows generic pending finalization recovery and prevents another action without staged outcome text', async () => {
  const campaign = { ...fixtureCampaign(), turns: [pending()] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      if (path.startsWith('/api/providers')) return reply(providers);
      if (path.startsWith('/api/settings')) return reply(options);
      if (path.endsWith('/rule-system'))
        return reply({
          kind: 'model_knowledge',
          systemName: 'Model knowledge',
          sheetLayout: { fields: [] },
        });
      return reply(campaign);
    })
  );
  render(
    <MemoryRouter initialEntries={[`/campaigns/${campaign.id}`]}>
      <Routes>
        <Route path="/campaigns/:id" element={<PlayPage />} />
      </Routes>
    </MemoryRouter>
  );
  const composer = await screen.findByLabelText('Your action');
  fireEvent.change(composer, { target: { value: 'A different action.' } });
  expect(screen.getByText(/Finish turn finalization before continuing/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Resume turn finalization' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Send action' })).toBeDisabled();
  expect(screen.queryByText(fixtureTurn().narrative!)).not.toBeInTheDocument();
  expect(
    screen.queryByText(/STAGED_NARRATIVE_MARKER|STAGED_OUTCOME_MARKER/)
  ).not.toBeInTheDocument();
});
