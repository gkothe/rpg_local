import { beforeAll, afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CharacterSection from '../src/features/characters/CharacterSection';
import { fixtureCampaign } from './fixtures';

beforeAll(() => {
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
});
afterEach(() => vi.unstubAllGlobals());

const inventory = {
  sword: { name: 'Sword', type: 'weapon', damage: 10, equipped: true, details: { note: 'Sharp' } },
  axe: { name: 'Axe', type: 'weapon', damage: 2 },
  bag: { name: 'Bag', type: 'item' },
};

function setup(data: Record<string, unknown> = inventory) {
  const campaign = fixtureCampaign();
  const character = { ...campaign.characters[0], inventory: data };
  const onSaved = vi.fn();
  const props = { campaign, character, field: 'inventory' as const, label: 'Inventory', onSaved };
  return { ...render(<CharacterSection {...props} />), props, onSaved };
}

it('cancels without saving, then deletes the sorted keyed item while preserving refreshed neighbors', async () => {
  const fetcher = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ data: fixtureCampaign() }))
  );
  vi.stubGlobal('fetch', fetcher);
  const view = setup();
  fireEvent.change(screen.getByLabelText('Sort items by'), { target: { value: 'name' } });
  fireEvent.click(screen.getByRole('button', { name: 'Delete Axe' }));
  expect(screen.getByRole('dialog', { name: 'Delete Axe' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(fetcher).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Delete Axe' }));
  const fresh = { ...inventory, sword: { ...inventory.sword, damage: 20 } };
  view.rerender(
    <CharacterSection {...view.props} character={{ ...view.props.character, inventory: fresh }} />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Delete item' }));
  await waitFor(() => expect(view.onSaved).toHaveBeenCalledOnce());
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({
    revision: 1,
    inventory: { sword: fresh.sword, bag: fresh.bag },
  });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('splices a nested list item and keeps deletion failures in the confirmation modal', async () => {
  const fetcher = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ detail: 'Cannot save.' }), { status: 409 })
  );
  vi.stubGlobal('fetch', fetcher);
  setup({ gear: [inventory.sword, inventory.axe] });
  fireEvent.click(screen.getByRole('button', { name: 'Delete Sword' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete item' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Cannot save.'));
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).inventory).toEqual({
    gear: [inventory.axe],
  });
  expect(screen.getByRole('dialog', { name: 'Delete Sword' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Delete Sword' })).toBeInTheDocument();
});

it('requires a fresh confirmation if the selected item changes', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const view = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Delete Axe' }));
  view.rerender(
    <CharacterSection
      {...view.props}
      character={{
        ...view.props.character,
        inventory: { ...inventory, axe: { ...inventory.axe, damage: 7 } },
      }}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Delete item' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('This item changed.'));
  expect(fetcher).not.toHaveBeenCalled();
});

it('sorts by available keys numerically, keeps missing values last and edits the original keyed item', async () => {
  const fetcher = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ data: fixtureCampaign() }))
  );
  vi.stubGlobal('fetch', fetcher);
  const { container } = setup();
  fireEvent.change(screen.getByLabelText('Sort items by'), { target: { value: 'damage' } });
  const names = () =>
    [...container.querySelectorAll('.sheet-item strong')].map((node) => node.textContent);
  expect(names()).toEqual(['Axe', 'Sword', 'Bag']);
  fireEvent.change(screen.getByLabelText('Sort direction'), { target: { value: 'descending' } });
  expect(names()).toEqual(['Sword', 'Axe', 'Bag']);
  fireEvent.click(screen.getByRole('button', { name: 'Edit Axe' }));
  const modal = within(screen.getByRole('dialog'));
  fireEvent.change(modal.getByLabelText('damage'), { target: { value: '5' } });
  fireEvent.click(modal.getByRole('button', { name: 'Save item' }));
  await waitFor(() => expect(modal.getByRole('status')).toHaveTextContent('Item saved.'));
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({
    revision: 1,
    inventory: { ...inventory, axe: { ...inventory.axe, damage: 5 } },
  });
});

it('preserves modal drafts during refresh, merges changed leaves, and supports repeat saves', async () => {
  const fetcher = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ data: fixtureCampaign() }))
  );
  vi.stubGlobal('fetch', fetcher);
  const view = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Sword' }));
  const modal = within(screen.getByRole('dialog'));
  fireEvent.change(modal.getByLabelText('damage'), { target: { value: '12' } });
  fireEvent.click(modal.getByLabelText('equipped'));
  const refreshed = {
    ...inventory,
    sword: { ...inventory.sword, details: { note: 'Refreshed' } },
    coins: { name: 'Coins' },
  };
  view.rerender(
    <CharacterSection
      {...view.props}
      character={{ ...view.props.character, inventory: refreshed }}
    />
  );
  expect(modal.getByLabelText('damage')).toHaveValue(12);
  fireEvent.click(modal.getByRole('button', { name: 'Save item' }));
  await waitFor(() => expect(modal.getByRole('status')).toBeVisible());
  const saved = { ...refreshed, sword: { ...refreshed.sword, damage: 12, equipped: false } };
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).inventory).toEqual(saved);
  view.rerender(
    <CharacterSection {...view.props} character={{ ...view.props.character, inventory: saved }} />
  );
  fireEvent.change(modal.getByLabelText('damage'), { target: { value: '10' } });
  fireEvent.click(modal.getByRole('button', { name: 'Save item' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string).inventory.sword.damage).toBe(10);
  fireEvent.click(modal.getByRole('button', { name: 'Close' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit Sword' }));
  expect(screen.getByLabelText('note')).toHaveValue('Refreshed');
});

it('saves nested list items at their original index and retains errors and drafts', async () => {
  const fetcher = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ detail: 'Save failed.' }), { status: 409 })
  );
  vi.stubGlobal('fetch', fetcher);
  setup({ gear: [inventory.sword, inventory.axe] });
  fireEvent.change(screen.getByLabelText('Sort items by'), { target: { value: 'name' } });
  fireEvent.click(screen.getByRole('button', { name: 'Edit Axe' }));
  fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Bronze axe' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save item' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Save failed.'));
  expect(screen.getByLabelText('name')).toHaveValue('Bronze axe');
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).inventory.gear).toEqual([
    inventory.sword,
    { ...inventory.axe, name: 'Bronze axe' },
  ]);
});

it('rejects a refreshed list whose edited position now contains another item', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const view = setup({ gear: [inventory.sword, inventory.axe] });
  fireEvent.click(screen.getByRole('button', { name: 'Edit Axe' }));
  fireEvent.change(screen.getByLabelText('damage'), { target: { value: '8' } });
  view.rerender(
    <CharacterSection
      {...view.props}
      character={{ ...view.props.character, inventory: { gear: [inventory.axe, inventory.sword] } }}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save item' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('This list changed.'));
  expect(fetcher).not.toHaveBeenCalled();
  expect(screen.getByLabelText('damage')).toHaveValue(8);
});
