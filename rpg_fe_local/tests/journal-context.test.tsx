import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Journal from '../src/features/journal/Journal';
import { fixtureCampaign, fixtureTurn, options } from './fixtures';

afterEach(() => vi.unstubAllGlobals());

function expandContext() {
  const details = screen.getByText('Inspect last turn context').closest('details')!;
  details.open = true;
  fireEvent(details, new Event('toggle'));
}

it('loads full saved instructions only when context inspection is expanded and renders them literally', async () => {
  const campaign = fixtureCampaign();
  campaign.turns = [fixtureTurn()];
  campaign.turns[0]!.context = { diceSessionId: 'root', promptContractVersion: 4 };
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
  finishOld(new Response(JSON.stringify({ data: { systemPrompt: 'Outdated instructions' } })));
  await waitFor(() => expect(screen.queryByText(/Outdated instructions/)).not.toBeInTheDocument());
  expect(screen.getByText(/New saved instructions/)).toBeInTheDocument();
});
