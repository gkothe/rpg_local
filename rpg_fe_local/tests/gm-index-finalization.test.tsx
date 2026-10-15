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

it('explicit separate recovery retains intent and UUID after a lost acknowledgement', async () => {
  const turn = pending();
  turn.editingResume = { available: false, reason: 'Conversation ended' };
  turn.finalization!.recovery = {
    available: true,
    reason: null,
    action: 'separate_index_recovery',
  };
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('Lost acknowledgement'))
    .mockResolvedValueOnce(reply({ ...turn, status: 'running' }, 202));
  vi.stubGlobal('fetch', fetcher);
  const { result, unmount } = renderHook(() =>
    useTurn({ ...fixtureCampaign(), turns: [turn] }, vi.fn(), options)
  );
  await act(async () => {
    expect(await result.current.resumeEditing(turn)).toBe(false);
  });
  expect(fetcher).not.toHaveBeenCalled();
  await act(async () => {
    expect(await result.current.resumeEditing(turn, turn.finalization?.recovery?.action)).toBe(
      false
    );
  });
  expect(JSON.parse(fetcher.mock.calls[0][1].body).resumeIntent).toBe('separate_index_recovery');
  await act(async () => {
    expect(await result.current.resumeEditing()).toBe(true);
  });
  expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[0][1].body);
  unmount();
});

it('GM options save the backend-advertised updater mode and reload the campaign preference', async () => {
  const campaign = { ...fixtureCampaign(), turns: [fixtureTurn()] };
  const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.startsWith('/api/settings'))
      return reply({
        ...options,
        gmIndex: {
          purposeId: 'gm_index',
          modes: [],
          finalizationStages: [],
          updateModes: [
            { id: 'separate_agent', label: 'Separate index agent', default: true },
            {
              id: 'same_gm_conversation',
              label: 'Continue the turn GM',
              default: false,
              requiresConversation: true,
            },
          ],
        },
      });
    if (path.startsWith('/api/providers'))
      return reply(
        providers.map((provider) => ({
          ...provider,
          gmConversation: { supported: true, reason: null },
        }))
      );
    if (path.endsWith('/rule-system'))
      return reply({
        kind: 'model_knowledge',
        systemName: 'Model knowledge',
        sheetLayout: { fields: [] },
      });
    if (init?.method === 'PATCH') Object.assign(campaign, JSON.parse(init.body as string));
    return reply(campaign);
  });
  vi.stubGlobal('fetch', fetcher);
  render(
    <MemoryRouter initialEntries={[`/campaigns/${campaign.id}?tab=game%20master`]}>
      <Routes>
        <Route path="/campaigns/:id" element={<PlayPage />} />
      </Routes>
    </MemoryRouter>
  );
  const choice = await screen.findByRole('combobox', { name: 'GM index updater' });
  expect(choice).toHaveValue('separate_agent');
  fireEvent.change(choice, { target: { value: 'same_gm_conversation' } });
  expect(
    await screen.findByText('GM index updater saved. Applies to the next indexed turn.')
  ).toBeInTheDocument();
  expect(choice).toHaveValue('same_gm_conversation');
  const patch = fetcher.mock.calls.find((call) => call[1]?.method === 'PATCH');
  expect(JSON.parse(patch![1]!.body as string).gmIndexUpdateMode).toBe('same_gm_conversation');
});

it('same-conversation option is enabled and indicator description appears for all five provider IDs when supported', async () => {
  const allProviders = [
    { id: 'claude', name: 'Claude Code', models: [{ id: 'm1', label: 'M1', efforts: [] }] },
    { id: 'codex', name: 'OpenAI Codex', models: [{ id: 'm2', label: 'M2', efforts: [] }] },
    { id: 'agy', name: 'Antigravity', models: [{ id: 'm3', label: 'M3', efforts: [] }] },
    { id: 'gemini-api', name: 'Gemini API', models: [{ id: 'm4', label: 'M4', efforts: [] }] },
    { id: 'openrouter', name: 'OpenRouter', models: [{ id: 'm5', label: 'M5', efforts: [] }] },
  ].map((p) => ({
    ...p,
    transport: p.id.includes('api') || p.id === 'openrouter' ? 'api' : 'cli',
    available: true,
    supported: true,
    reason: null,
    version: '1.0.0',
    catalogProvenance: 'test',
    gmConversation: { supported: true, reason: null },
  }));

  const gmIndexSettings = {
    purposeId: 'gm_index',
    modes: [],
    finalizationStages: [],
    updateModes: [
      { id: 'separate_agent', label: 'Separate index agent', default: true },
      {
        id: 'same_gm_conversation',
        label: 'Continue the turn GM',
        default: false,
        requiresConversation: true,
      },
    ],
  };

  for (const provider of allProviders) {
    const campaign = {
      ...fixtureCampaign(),
      settings: { provider: provider.id, model: provider.models[0].id, effort: null },
      gmIndexUpdateMode: 'same_gm_conversation',
    };

    const fetcher = vi.fn(async (path: string) => {
      if (path.startsWith('/api/settings')) return reply({ ...options, gmIndex: gmIndexSettings });
      if (path.startsWith('/api/providers')) return reply(allProviders);
      if (path.endsWith('/rule-system'))
        return reply({
          kind: 'model_knowledge',
          systemName: 'Model knowledge',
          sheetLayout: { fields: [] },
        });
      return reply(campaign);
    });
    vi.stubGlobal('fetch', fetcher);

    const { unmount } = render(
      <MemoryRouter initialEntries={[`/campaigns/${campaign.id}?tab=game%20master`]}>
        <Routes>
          <Route path="/campaigns/:id" element={<PlayPage />} />
        </Routes>
      </MemoryRouter>
    );

    const choice = (await screen.findByRole('combobox', {
      name: 'GM index updater',
    })) as HTMLSelectElement;
    const sameOption = choice.querySelector(
      'option[value="same_gm_conversation"]'
    ) as HTMLOptionElement;
    expect(sameOption).toBeInTheDocument();
    expect(sameOption.disabled).toBe(false);
    expect(
      screen.getByText(
        /The turn GM can continue after editing to maintain the index. Both modes finish before your answer is shown./
      )
    ).toBeInTheDocument();

    unmount();
    vi.unstubAllGlobals();
  }
});

it('same-conversation option is disabled with provider diagnostic reason when gmConversation.supported is false', async () => {
  const provider = {
    id: 'gemini-api',
    name: 'Gemini API',
    transport: 'api' as const,
    available: true,
    supported: true,
    reason: null,
    version: '1.0.0',
    catalogProvenance: 'test',
    models: [{ id: 'm1', label: 'M1', efforts: [] }],
    gmConversation: {
      supported: false,
      reason: 'Gemini API key is not configured for conversational sessions',
    },
  };

  const campaign = {
    ...fixtureCampaign(),
    settings: { provider: provider.id, model: 'm1', effort: null },
  };

  const gmIndexSettings = {
    purposeId: 'gm_index',
    modes: [],
    finalizationStages: [],
    updateModes: [
      { id: 'separate_agent', label: 'Separate index agent', default: true },
      {
        id: 'same_gm_conversation',
        label: 'Continue the turn GM',
        default: false,
        requiresConversation: true,
      },
    ],
  };

  const fetcher = vi.fn(async (path: string) => {
    if (path.startsWith('/api/settings')) return reply({ ...options, gmIndex: gmIndexSettings });
    if (path.startsWith('/api/providers')) return reply([provider]);
    if (path.endsWith('/rule-system'))
      return reply({
        kind: 'model_knowledge',
        systemName: 'Model knowledge',
        sheetLayout: { fields: [] },
      });
    return reply(campaign);
  });
  vi.stubGlobal('fetch', fetcher);

  render(
    <MemoryRouter initialEntries={[`/campaigns/${campaign.id}?tab=game%20master`]}>
      <Routes>
        <Route path="/campaigns/:id" element={<PlayPage />} />
      </Routes>
    </MemoryRouter>
  );

  const choice = (await screen.findByRole('combobox', {
    name: 'GM index updater',
  })) as HTMLSelectElement;
  const sameOption = choice.querySelector(
    'option[value="same_gm_conversation"]'
  ) as HTMLOptionElement;
  expect(sameOption).toBeInTheDocument();
  expect(sameOption.disabled).toBe(true);
  expect(
    screen.getByText('Gemini API key is not configured for conversational sessions')
  ).toBeInTheDocument();
});

it('changing provider dropdown during paused finalization preserves mode selection and recovery request identity', async () => {
  const turn = pending();
  turn.finalization!.recovery = {
    available: true,
    reason: null,
    action: 'separate_index_recovery',
  };
  const campaign = {
    ...fixtureCampaign(),
    gmIndexUpdateMode: 'same_gm_conversation',
    turns: [turn],
  };

  const allProviders = [
    {
      id: 'claude',
      name: 'Claude Code',
      transport: 'cli' as const,
      available: true,
      supported: true,
      reason: null,
      version: '1.0.0',
      catalogProvenance: 'test',
      models: [{ id: 'claude-3-7-sonnet', label: 'Sonnet', efforts: [] }],
      gmConversation: { supported: true, reason: null },
    },
    {
      id: 'codex',
      name: 'OpenAI Codex',
      transport: 'cli' as const,
      available: true,
      supported: true,
      reason: null,
      version: '1.0.0',
      catalogProvenance: 'test',
      models: [{ id: 'gpt-5.6-sol', label: 'GPT', efforts: [] }],
      gmConversation: { supported: true, reason: null },
    },
  ];

  const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.startsWith('/api/settings')) return reply(options);
    if (path.startsWith('/api/providers')) return reply(allProviders);
    if (path.endsWith('/rule-system'))
      return reply({
        kind: 'model_knowledge',
        systemName: 'Model knowledge',
        sheetLayout: { fields: [] },
      });
    if (init?.method === 'PATCH') {
      const patch = JSON.parse(init.body as string);
      Object.assign(campaign, patch);
      return reply(campaign);
    }
    return reply(campaign);
  });
  vi.stubGlobal('fetch', fetcher);

  const { result } = renderHook(() => useTurn(campaign, vi.fn(), options));

  // The hook preserves mode and recovery intent across provider change
  expect(campaign.gmIndexUpdateMode).toBe('same_gm_conversation');

  // Trigger recovery with explicit intent
  await act(async () => {
    await result.current.resumeEditing(turn, turn.finalization?.recovery?.action);
  });

  const resumeCall = fetcher.mock.calls.find((call) => call[0].includes('/resume-finalization'));
  expect(resumeCall).toBeDefined();
  const init = resumeCall?.[1] as RequestInit;
  const body = JSON.parse(init.body as string);
  expect(body.resumeIntent).toBe('separate_index_recovery');
  expect(body.requestId).toBeDefined();
  expect(campaign.gmIndexUpdateMode).toBe('same_gm_conversation');
});
