import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PlayPage from '../src/pages/Play';
import { fixtureCampaign, options, providers } from './fixtures';

afterEach(() => vi.unstubAllGlobals());
const renderPlay = async (ruleSystem: unknown) => {
  const campaign = fixtureCampaign();
  campaign.characters[0].attributes = { skills: { Brawl: 2 } };
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (path: string) => {
      const data = path.startsWith('/api/providers')
        ? providers
        : path === '/api/settings'
          ? options
          : path.endsWith('/rule-system')
            ? ruleSystem
            : campaign;
      return new Response(JSON.stringify({ data }), { status: 200 });
    })
  );
  render(
    <MemoryRouter initialEntries={[`/campaigns/${campaign.id}`]}>
      <Routes>
        <Route path="/campaigns/:id" element={<PlayPage />} />
      </Routes>
    </MemoryRouter>
  );
  await screen.findByLabelText('Your action');
};

describe('Play character sheets use the rule system layout', () => {
  it('draws hinted dots when the rule system serves a layout', async () => {
    await renderPlay({
      sheetLayout: { fields: [{ path: ['attributes', 'skills'], widget: 'dots', max: 5 }] },
    });
    expect(await screen.findByRole('img', { hidden: true, name: 'Brawl 2 of 5' })).toBeDefined();
  });
  it.each([[{}], [[]], [{ sheetLayout: { fields: [] } }]])(
    'shows plain numbers for %j',
    async (served) => {
      await renderPlay(served);
      expect(document.querySelector('.sheet-pips')).toBeNull();
      expect(screen.getAllByText('Brawl', { exact: true })[0]).toBeDefined();
    }
  );
});
