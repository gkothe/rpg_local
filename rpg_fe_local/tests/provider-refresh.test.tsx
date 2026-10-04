import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Setup from '../src/pages/Setup';
import PlayPage from '../src/pages/Play';
import SettingsPage from '../src/pages/Settings';
import { LanContext } from '../src/features/connections/LanContext';
import { fixtureCampaign, fixtureTurn, options, providers } from './fixtures';
import ProviderPicker from '../src/features/providers/ProviderPicker';

it('provider picker excludes unverified dice models and selects a verified model', () => {
  const onChange = vi.fn();
  const verified = {
    ...providers[0],
    dice: { supported: true, reason: null },
    models: [
      {
        id: 'blocked',
        label: 'Blocked model',
        efforts: ['low'],
        inputTokens: 8000,
        dice: { supported: false, reason: 'Budget not verified' },
      },
      {
        id: 'verified',
        label: 'Verified model',
        efforts: ['low'],
        inputTokens: 8000,
        dice: { supported: true, reason: null },
      },
    ],
  };
  render(
    <ProviderPicker
      providers={[verified]}
      value={{ provider: verified.id, model: 'blocked', effort: 'low' }}
      onChange={onChange}
    />
  );
  expect(
    (screen.getByRole('option', { name: 'Blocked model' }) as HTMLOptionElement).disabled
  ).toBe(true);
  fireEvent.change(screen.getByLabelText('AI CLI'), { target: { value: verified.id } });
  expect(onChange).toHaveBeenCalledWith({
    provider: verified.id,
    model: 'verified',
    effort: 'low',
  });
});

afterEach(() => vi.unstubAllGlobals());

it('shows automatic knowledge changes as text in the existing chat and preserves the draft', async () => {
  const campaign = fixtureCampaign();
  const change = '<img src=x onerror=alert(1)>: knowledge introduced (gm, rumor, active)';
  campaign.turns = [{ ...fixtureTurn(), changes: [change] }];
  const fetcher = vi.fn().mockImplementation(async (path: string) => {
    const data = path.startsWith('/api/providers')
      ? providers
      : path === '/api/settings'
        ? options
        : campaign;
    return new Response(JSON.stringify({ data }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetcher);
  const { container } = render(
    <MemoryRouter initialEntries={[`/campaigns/${campaign.id}`]}>
      <Routes>
        <Route path="/campaigns/:id" element={<PlayPage />} />
      </Routes>
    </MemoryRouter>
  );
  const action = await screen.findByLabelText('Your action');
  fireEvent.change(action, { target: { value: 'Ask about the rumor' } });
  expect(screen.getByLabelText('Show debug info')).not.toBeChecked();
  expect(screen.queryByText(change)).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Show debug info'));
  expect(await screen.findByText(change)).toBeInTheDocument();
  expect(container.querySelector('img')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Game master' }));
  fireEvent.click(screen.getByRole('button', { name: 'Play' }));
  expect(screen.getByLabelText('Your action')).toHaveValue('Ask about the rumor');
  expect(screen.getByText(change)).toBeInTheDocument();
});

it('allows selecting an untested provider and shows its compatibility warning', () => {
  const onChange = vi.fn();
  const provider = {
    ...providers[0],
    compatibilityWarning: 'Untested CLI version. Gameplay is allowed.',
  };
  render(
    <ProviderPicker
      providers={[provider]}
      value={{ provider: provider.id, model: provider.models[0]!.id, effort: null }}
      onChange={onChange}
    />
  );
  expect(screen.getByRole('status')).toHaveTextContent(provider.compatibilityWarning);
  expect(screen.getByRole('option', { name: provider.name })).not.toBeDisabled();
  fireEvent.change(screen.getByLabelText('AI CLI'), { target: { value: provider.id } });
  expect(onChange).toHaveBeenCalled();
});

describe('CLI diagnostic refresh', () => {
  for (const page of ['setup', 'play', 'settings']) {
    it(`bypasses the backend provider cache from ${page}`, async () => {
      const fetcher = vi.fn().mockImplementation(async (path: string) => {
        const data = path.startsWith('/api/providers')
          ? providers
          : path === '/api/settings'
            ? options
            : fixtureCampaign();
        return new Response(JSON.stringify({ data }), { status: 200 });
      });
      vi.stubGlobal('fetch', fetcher);
      render(
        <MemoryRouter
          initialEntries={[page === 'play' ? `/campaigns/${fixtureCampaign().id}` : '/']}
        >
          <LanContext.Provider
            value={{
              status: null,
              error: '',
              refresh: vi.fn(),
              requirePairing: vi.fn(),
              paired: vi.fn(),
            }}
          >
            <Routes>
              <Route path="/" element={page === 'setup' ? <Setup /> : <SettingsPage />} />
              <Route path="/campaigns/:id" element={<PlayPage />} />
            </Routes>
          </LanContext.Provider>
        </MemoryRouter>
      );
      if (page === 'play')
        fireEvent.click(await screen.findByRole('button', { name: 'Game master' }));
      const button = await screen.findByRole('button', {
        name: page === 'settings' ? 'Refresh diagnostics' : 'Refresh CLI diagnostics',
      });
      fireEvent.click(button);
      await waitFor(() =>
        expect(fetcher).toHaveBeenCalledWith('/api/providers?refresh=true', expect.anything())
      );
    });
  }
});

it('switches providers in an existing game without losing its draft or history', async () => {
  const campaign = fixtureCampaign();
  campaign.turns = [fixtureTurn()];
  const next = { provider: 'agy', model: 'other-model', effort: 'high' };
  const available = [
    ...providers,
    {
      ...providers[0],
      id: 'agy',
      name: 'Antigravity',
      models: [{ id: next.model, label: 'Other model', efforts: ['high'], inputTokens: 16000 }],
    },
  ];
  const fetcher = vi.fn().mockImplementation(async (path: string, init: RequestInit) => {
    let data: unknown = campaign;
    if (path.startsWith('/api/providers')) data = available;
    else if (path === '/api/settings') data = options;
    else if (init.method === 'PATCH') {
      const payload = JSON.parse(String(init.body));
      expect(payload.revision).toBe(campaign.revision);
      campaign.settings = payload.settings;
      campaign.revision++;
    } else if (init.method === 'POST' && path.endsWith('/turns')) {
      data = { ...fixtureTurn(), id: 'new-turn', status: 'pending' };
    }
    return new Response(JSON.stringify({ data }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetcher);
  render(
    <MemoryRouter initialEntries={[`/campaigns/${campaign.id}`]}>
      <Routes>
        <Route path="/campaigns/:id" element={<PlayPage />} />
      </Routes>
    </MemoryRouter>
  );
  const action = await screen.findByLabelText('Your action');
  fireEvent.change(action, { target: { value: 'Speak to Marta' } });
  fireEvent.click(screen.getByRole('button', { name: 'Game master' }));
  await screen.findByRole('option', { name: 'Antigravity' });
  fireEvent.change(screen.getByLabelText('AI CLI'), { target: { value: 'agy' } });
  await screen.findByText('Game master settings saved.');
  fireEvent.click(screen.getByRole('button', { name: 'Play' }));
  expect(action).toHaveValue('Speak to Marta');
  expect(screen.getByText(fixtureTurn().narrative!)).toBeInTheDocument();
  expect(campaign.characters[0].attributes.health).toBe(12);
  expect(campaign.pinnedFacts).toEqual(['The northern bridge was destroyed.']);
  expect(campaign.settings).toEqual(next);
  fireEvent.submit(action.closest('form')!);
  await waitFor(() => {
    const sent = fetcher.mock.calls.find(
      ([path, init]) => path.endsWith('/turns') && init.method === 'POST'
    );
    expect(sent).toBeDefined();
    expect(JSON.parse(String(sent![1].body))).toMatchObject({
      action: 'Speak to Marta',
      revision: 2,
      settings: next,
    });
  });
});

it('shows a spinner and cancellation while the GM processes a turn', async () => {
  const campaign = fixtureCampaign();
  const pending = { ...fixtureTurn(), status: 'pending', narrative: null };
  campaign.turns = [pending];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (path: string) => {
      const data = path.startsWith('/api/providers')
        ? providers
        : path === '/api/settings'
          ? options
          : path.includes('/turns/')
            ? pending
            : campaign;
      return new Response(JSON.stringify({ data }));
    })
  );
  const { container } = render(
    <MemoryRouter initialEntries={[`/campaigns/${campaign.id}`]}>
      <Routes>
        <Route path="/campaigns/:id" element={<PlayPage />} />
      </Routes>
    </MemoryRouter>
  );
  const busy = await screen.findByRole('button', { name: /GM is responding/ });
  expect(busy).toBeDisabled();
  expect(busy.querySelector('.loading-spinner')).not.toBeNull();
  expect(container.querySelector('[role="status"] .loading-spinner')).not.toBeNull();
  expect(screen.getByRole('button', { name: /Cancel/ })).toBeEnabled();
  const action = screen.getByLabelText('Your action');
  fireEvent.change(action, { target: { value: 'My next action' } });
  expect(action).toHaveValue('My next action');
});
