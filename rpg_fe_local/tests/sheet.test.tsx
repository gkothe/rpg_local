import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import CharacterSheet from '../src/features/characters/CharacterSheet';
import { fixtureCampaign, options } from './fixtures';
afterEach(() => vi.unstubAllGlobals());
describe('draft protection', () => {
  it('cannot override captured revision or character identity through Advanced sheet JSON', async () => {
    const fetcher = vi.fn(
      async (_url: string, init?: RequestInit) =>
        new Response(JSON.stringify({ data: init?.method === 'POST' ? fixtureCampaign() : [] }))
    );
    vi.stubGlobal('fetch', fetcher);
    const campaign = fixtureCampaign();
    render(<CharacterSheet campaign={campaign} options={options} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByText('Add a character'));
    const creator = within(screen.getByText('Add a character').closest('details')!);
    fireEvent.change(creator.getByLabelText('Name'), { target: { value: 'My ranger' } });
    fireEvent.change(creator.getByLabelText('JSON'), {
      target: {
        value: JSON.stringify({
          revision: 999,
          name: 'Injected name',
          type: 'npc',
          attributes: {},
          inventory: {},
          description: {},
        }),
      },
    });
    fireEvent.click(creator.getByRole('button', { name: /^Add character$/ }));
    await waitFor(() =>
      expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true)
    );
    const mutation = fetcher.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(mutation![1]!.body as string)).toMatchObject({
      revision: 1,
      name: 'My ranger',
      type: 'player',
    });
  });
  it('keeps an AI character draft tied to its parsed revision through a turn refresh', async () => {
    const campaign = fixtureCampaign();
    campaign.sources = [
      {
        id: 'sheet',
        name: 'Reviewed ranger',
        kind: 'text',
        status: 'confirmed',
        text: 'Ranger',
        version: 1,
        pages: [],
        warnings: [],
      },
    ];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/character-drafts'))
        return new Response(
          JSON.stringify({
            data: { draft: { name: 'Arin', type: 'player', attributes: { health: 12 } } },
          })
        );
      if (init?.method === 'POST')
        return new Response(JSON.stringify({ detail: 'Campaign changed; review a new draft.' }), {
          status: 409,
        });
      return new Response(JSON.stringify({ data: [] }));
    });
    vi.stubGlobal('fetch', fetcher);
    const onSaved = vi.fn();
    const view = render(<CharacterSheet campaign={campaign} options={options} onSaved={onSaved} />);
    fireEvent.click(screen.getByText('Add a character'));
    fireEvent.change(screen.getByLabelText('Parse a confirmed source'), {
      target: { value: 'sheet' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate editable character draft' }));
    await waitFor(() => expect(screen.getByDisplayValue('Arin')).toBeInTheDocument());
    view.rerender(
      <CharacterSheet campaign={{ ...campaign, revision: 2 }} options={options} onSaved={onSaved} />
    );
    fireEvent.click(screen.getByRole('button', { name: /^Add character$/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Campaign changed'));
    const mutation = fetcher.mock.calls.find(([url]) => url.endsWith('/characters'));
    expect(JSON.parse(mutation![1]!.body as string)).toMatchObject({
      revision: 1,
      name: 'Arin',
      attributes: { health: 12 },
    });
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Arin')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Discard character draft' }));
    expect(screen.queryByDisplayValue('Arin')).not.toBeInTheDocument();
  });
  it('keeps local character edits and the original revision when fresh turn state arrives', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'PATCH'
        ? new Response(
            JSON.stringify({ detail: 'Reload current character to resolve this conflict.' }),
            { status: 409 }
          )
        : new Response(JSON.stringify({ data: [] }))
    );
    vi.stubGlobal('fetch', fetcher);
    const campaign = fixtureCampaign();
    const onSaved = vi.fn();
    const view = render(<CharacterSheet campaign={campaign} options={options} onSaved={onSaved} />);
    view.rerender(
      <CharacterSheet campaign={campaign} options={options} onSaved={onSaved} category="npcs" />
    );
    fireEvent.click(screen.getByText('Marta', { selector: 'summary' }));
    const editor = within(screen.getByRole('heading', { name: 'Marta npc' }).closest('article')!);
    fireEvent.click(editor.getByText('Edit character'));
    fireEvent.change(editor.getByLabelText('Name'), { target: { value: 'My unsaved name' } });
    view.rerender(
      <CharacterSheet
        campaign={{
          ...campaign,
          revision: 2,
          characters: [{ ...campaign.characters[0], attributes: { health: 5 } }],
        }}
        options={options}
        onSaved={onSaved}
        category="npcs"
      />
    );
    expect(editor.getByLabelText('Name')).toHaveValue('My unsaved name');
    fireEvent.click(editor.getByRole('button', { name: 'Save character' }));
    await waitFor(() =>
      expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1)
    );
    const mutation = fetcher.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(mutation![1]!.body as string)).toMatchObject({
      revision: 1,
      name: 'My unsaved name',
    });
    expect(JSON.parse(mutation![1]!.body as string)).not.toHaveProperty('attributes');
    await waitFor(() =>
      expect(editor.getByRole('alert')).toHaveTextContent('Reload current character')
    );
    expect(onSaved).not.toHaveBeenCalled();
    fireEvent.click(editor.getByRole('button', { name: 'Reload current character' }));
    expect(editor.getByLabelText('Name')).toHaveValue('Marta');
  });
});
