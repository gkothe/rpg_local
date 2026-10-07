import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Journal from '../src/features/journal/Journal';
import { fixtureCampaign, options } from './fixtures';

vi.mock('../src/features/journal/JournalKnowledge', () => ({ default: () => null }));
vi.mock('../src/features/journal/HistoryMemory', () => ({ default: () => null }));

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
  const button = await screen.findByRole('button', { name: 'Rebuild memory' });
  await waitFor(() => expect(button).toBeEnabled());
  expect(button.closest('details')).toBeNull();
  fireEvent.change(screen.getByLabelText(/Personal notes/), { target: { value: 'my draft' } });
  view.rerender(
    <Journal campaign={{ ...campaign, revision: 2 }} options={options} onSaved={async () => {}} />
  );
  expect(screen.getByLabelText(/Personal notes/)).toHaveValue('my draft');
  expect(screen.getByText('Marta has the key.')).toBeInTheDocument();
});
