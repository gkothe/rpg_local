import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CharacterSection from '../src/features/characters/CharacterSection';
import { fixtureCampaign } from './fixtures';

afterEach(() => vi.unstubAllGlobals());
describe('character section editing', () => {
  it('swaps views, retains drafts through refresh, and saves only its section at the captured revision', async () => {
    const campaign = fixtureCampaign();
    const saved = {
      ...campaign,
      revision: 3,
      characters: [{ ...campaign.characters[0], inventory: { sword: 2 } }],
    };
    const fetcher = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ data: saved }))
    );
    vi.stubGlobal('fetch', fetcher);
    const onSaved = vi.fn();
    const view = render(
      <CharacterSection
        campaign={campaign}
        character={campaign.characters[0]}
        field="inventory"
        label="Inventory"
        onSaved={onSaved}
      />
    );
    expect(screen.getByText('silver')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Edit JSON' }));
    expect(screen.queryByText('silver')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Inventory JSON'), { target: { value: '{"sword":2}' } });
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    const fresh = { ...campaign, revision: 2 };
    view.rerender(
      <CharacterSection
        campaign={fresh}
        character={fresh.characters[0]}
        field="inventory"
        label="Inventory"
        onSaved={onSaved}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit JSON' }));
    expect(screen.getByLabelText('Inventory JSON')).toHaveValue('{"sword":2}');
    fireEvent.click(screen.getByRole('button', { name: 'Save Inventory' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({
      revision: 1,
      inventory: { sword: 2 },
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit JSON' })).toBeVisible());
    view.rerender(
      <CharacterSection
        campaign={saved}
        character={saved.characters[0]}
        field="inventory"
        label="Inventory"
        onSaved={onSaved}
      />
    );
    expect(screen.getByText('sword')).toBeVisible();
  });
  it('keeps invalid JSON and conflicting edits open until explicitly reloaded', async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ detail: 'Campaign changed.' }), { status: 409 })
    );
    vi.stubGlobal('fetch', fetcher);
    const campaign = fixtureCampaign();
    const onSaved = vi.fn();
    const view = render(
      <CharacterSection
        campaign={campaign}
        character={campaign.characters[0]}
        field="attributes"
        label="Skills / Attributes"
        onSaved={onSaved}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit JSON' }));
    fireEvent.change(screen.getByLabelText('Skills / Attributes JSON'), {
      target: { value: '[]' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Skills / Attributes' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeVisible());
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Skills / Attributes JSON'), {
      target: { value: '{"health":8}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Skills / Attributes' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Campaign changed.'));
    expect(screen.getByLabelText('Skills / Attributes JSON')).toHaveValue('{"health":8}');
    expect(onSaved).not.toHaveBeenCalled();
    const fresh = {
      ...campaign,
      revision: 2,
      characters: [{ ...campaign.characters[0], attributes: { health: 5 } }],
    };
    view.rerender(
      <CharacterSection
        campaign={fresh}
        character={fresh.characters[0]}
        field="attributes"
        label="Skills / Attributes"
        onSaved={onSaved}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reload current section' }));
    expect(screen.getByLabelText('Skills / Attributes JSON')).toHaveValue(
      JSON.stringify({ health: 5 }, null, 2)
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('character section layout', () => {
  it('draws hinted fields in view mode while Edit JSON still opens the raw section', () => {
    const campaign = fixtureCampaign();
    const character = { ...campaign.characters[0], attributes: { skills: { Brawl: 2 } } };
    render(
      <CharacterSection
        campaign={campaign}
        character={character}
        field="attributes"
        label="Skills / Attributes"
        layout={{ fields: [{ path: ['attributes', 'skills'], widget: 'dots', max: 5 }] }}
        onSaved={vi.fn()}
      />
    );
    expect(screen.getByRole('img', { name: 'Brawl 2 of 5' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Edit JSON' }));
    expect(screen.getByLabelText('Skills / Attributes JSON')).toHaveValue(
      JSON.stringify({ skills: { Brawl: 2 } }, null, 2)
    );
  });
});
