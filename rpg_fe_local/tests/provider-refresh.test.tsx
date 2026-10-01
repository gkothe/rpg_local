import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Setup from '../src/pages/Setup';
import PlayPage from '../src/pages/Play';
import SettingsPage from '../src/pages/Settings';
import { LanContext } from '../src/features/connections/LanContext';
import { fixtureCampaign, options, providers } from './fixtures';

afterEach(() => vi.unstubAllGlobals());

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
