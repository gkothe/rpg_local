import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Journal from '../src/features/journal/Journal';
import { fixtureCampaign, options } from './fixtures';

vi.mock('../src/features/journal/JournalKnowledge', () => ({ default: () => null }));
vi.mock('../src/features/journal/HistoryMemory', () => ({ default: () => null }));
vi.mock('../src/features/advancement/Advancement', () => ({
  default: () => <p>Advancement review</p>,
}));

afterEach(() => vi.unstubAllGlobals());

it('shows the Rebuild memory control under the memory text and keeps notes drafts', async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(JSON.stringify({ data: { jobs: [], current: null, nextCursor: null } }))
  );
  vi.stubGlobal('fetch', fetcher);
  const campaign = fixtureCampaign();
  campaign.memory = {
    id: 'm',
    text: '- Marta has the key.',
    valid: true,
    coveredTurnIds: [],
    createdAt: new Date().toISOString(),
  };
  const view = render(<Journal campaign={campaign} options={options} onSaved={async () => {}} />);
  fireEvent.change(screen.getByLabelText(/Personal notes/, { selector: 'textarea' }), {
    target: { value: 'my draft' },
  });
  fireEvent.click(screen.getByRole('tab', { name: 'Campaign memory' }));
  const button = await screen.findByRole('button', { name: 'Rebuild memory' });
  await waitFor(() => expect(button).toBeEnabled());
  expect(button.closest('details')).toBeNull();
  view.rerender(
    <Journal campaign={{ ...campaign, revision: 2 }} options={options} onSaved={async () => {}} />
  );
  expect(screen.getByLabelText(/Personal notes/, { selector: 'textarea' })).toHaveValue('my draft');
  expect(screen.getByText('Marta has the key.')).toBeInTheDocument();
});

it('shows one Journal section at a time and supports keyboard tab navigation', () => {
  const advancementOptions = {
    ...options,
    advancement: { statuses: [], actions: [], kinds: [], bases: [], outcomes: [], limits: {} },
  };
  render(
    <Journal campaign={fixtureCampaign()} options={advancementOptions} onSaved={async () => {}} />
  );
  expect(screen.getAllByRole('tab')).toHaveLength(5);
  expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
  expect(screen.getByRole('tabpanel', { name: 'Personal notes' })).toBeVisible();
  const notes = screen.getByLabelText(/Personal notes/, { selector: 'textarea' });
  fireEvent.change(notes, { target: { value: 'Keep my notes' } });
  const notesTab = screen.getByRole('tab', { name: 'Personal notes' });
  fireEvent.keyDown(notesTab, { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: 'Campaign knowledge' })).toHaveFocus();
  expect(screen.getByRole('tabpanel', { name: 'Campaign knowledge' })).toBeVisible();
  expect(notes).not.toBeVisible();
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Campaign knowledge' }), { key: 'End' });
  expect(screen.getByRole('tab', { name: 'Advancement' })).toHaveFocus();
  expect(screen.getByRole('tabpanel', { name: 'Advancement' })).toBeVisible();
  expect(
    screen
      .getByRole('tablist', { name: 'Journal sections' })
      .compareDocumentPosition(screen.getByRole('tabpanel', { name: 'Advancement' })) &
      Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Advancement' }), { key: 'Home' });
  expect(notes).toBeVisible();
  expect(notes).toHaveValue('Keep my notes');
});
