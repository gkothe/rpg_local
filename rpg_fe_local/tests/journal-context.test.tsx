import { afterEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Journal from '../src/features/journal/Journal';
import CampaignContextSettings from '../src/features/journal/CampaignContextSettings';
import { fixtureCampaign, fixtureTurn, options } from './fixtures';

// The knowledge browser has its own tests; these cover notes, memory and context inspection.
vi.mock('../src/features/journal/JournalKnowledge', () => ({ default: () => null }));

afterEach(() => vi.unstubAllGlobals());

it('renders memory bullet points as list items while keeping legacy paragraphs readable', () => {
  const campaign = fixtureCampaign();
  campaign.memory = {
    id: 'summary',
    text: '- Marta has the key.\n- The gate remains locked.',
    valid: true,
    coveredTurnIds: [],
    createdAt: new Date().toISOString(),
  };
  const view = render(<Journal campaign={campaign} options={options} onSaved={async () => {}} />);
  expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
    'Marta has the key.',
    'The gate remains locked.',
  ]);
  view.rerender(
    <Journal
      campaign={{
        ...campaign,
        memory: { ...campaign.memory, text: 'An older paragraph summary.' },
      }}
      options={options}
      onSaved={async () => {}}
    />
  );
  expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  expect(screen.getByText('An older paragraph summary.')).toBeInTheDocument();
});

it('saves Description without pinned facts and keeps the draft through refreshes', async () => {
  const campaign = fixtureCampaign();
  const fetcher = vi.fn(async (_path: string, init?: RequestInit) => {
    const patch = JSON.parse(String(init?.body));
    expect(patch.description).toBe('Marta has a silver key.');
    expect(patch).not.toHaveProperty('pinnedFacts');
    return new Response(JSON.stringify({ data: { ...campaign, ...patch, revision: 2 } }));
  });
  vi.stubGlobal('fetch', fetcher);
  const onSaved = vi.fn(async () => {});
  const view = render(
    <CampaignContextSettings campaign={campaign} options={options} onSaved={onSaved} />
  );
  expect(screen.getByText('Description', { exact: true })).toHaveAttribute(
    'title',
    expect.stringContaining('It is not sent to the GM.')
  );
  fireEvent.change(screen.getByLabelText('Description'), {
    target: { value: 'Marta has a silver key.' },
  });
  view.rerender(
    <CampaignContextSettings
      campaign={{ ...campaign, revision: 2 }}
      options={options}
      onSaved={onSaved}
    />
  );
  expect(screen.getByLabelText('Description')).toHaveValue('Marta has a silver key.');
  expect(screen.queryByLabelText('Pinned campaign facts')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save context settings' }));
  await screen.findByText('Context settings saved.');
  expect(onSaved).toHaveBeenCalledOnce();
});

function expandContext() {
  const details = screen.getByText(/Advanced: inspect last turn context/).closest('details')!;
  details.open = true;
  fireEvent(details, new Event('toggle'));
}

it('loads full saved instructions only when context inspection is expanded and renders them literally', async () => {
  const campaign = fixtureCampaign();
  campaign.turns = [fixtureTurn()];
  campaign.turns[0]!.context = { diceSessionId: 'root' };
  const systemPrompt = '<script>Saved full system instructions</script>';
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ data: { systemPrompt, prompt: 'saved player context' } }))
    );
  vi.stubGlobal('fetch', fetcher);
  const { container } = render(
    <Journal campaign={campaign} options={options} onSaved={async () => {}} />
  );
  expect(fetcher).not.toHaveBeenCalled();
  expandContext();
  await screen.findByText(/Saved full system instructions/);
  expect(fetcher).toHaveBeenCalledWith(
    `/api/campaigns/${campaign.id}/turns/${campaign.turns[0]!.id}/context`,
    expect.anything()
  );
  expect(container.querySelector('script')).toBeNull();
});

it('does not replace a newer inspected turn with an older delayed response', async () => {
  const campaign = fixtureCampaign();
  campaign.turns = [{ ...fixtureTurn(), context: { prompt: 'initial' } }];
  let finishOld!: (response: Response) => void;
  const oldResponse = new Promise<Response>((resolve) => {
    finishOld = resolve;
  });
  const fetcher = vi
    .fn()
    .mockReturnValueOnce(oldResponse)
    .mockResolvedValue(
      new Response(JSON.stringify({ data: { systemPrompt: 'New saved instructions' } }))
    );
  vi.stubGlobal('fetch', fetcher);
  const { rerender } = render(
    <Journal campaign={campaign} options={options} onSaved={async () => {}} />
  );
  expandContext();
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  const updated = { ...campaign, turns: [{ ...campaign.turns[0]!, id: 'new-turn' }] };
  rerender(<Journal campaign={updated} options={options} onSaved={async () => {}} />);
  await screen.findByText(/New saved instructions/);
  await act(async () => {
    finishOld(new Response(JSON.stringify({ data: { systemPrompt: 'Outdated instructions' } })));
    await oldResponse;
  });
  await waitFor(() => expect(screen.queryByText(/Outdated instructions/)).not.toBeInTheDocument());
  expect(screen.getByText(/New saved instructions/)).toBeInTheDocument();
});

it('shows active context targets without the retired memory setting', () => {
  render(
    <CampaignContextSettings
      campaign={fixtureCampaign()}
      options={options}
      onSaved={async () => {}}
    />
  );
  expect(screen.queryByLabelText('Gameplay tokens')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Compaction batch target (UTF-8 bytes)')).toBeInTheDocument();
  expect(screen.queryByLabelText('Memory tokens')).not.toBeInTheDocument();
});
