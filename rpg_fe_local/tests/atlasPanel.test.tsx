import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AtlasPanel from '../src/features/atlas/AtlasPanel';
import type { AtlasData } from '../src/features/atlas/types';

afterEach(() => vi.unstubAllGlobals());
const reply = (data: unknown) => new Response(JSON.stringify({ data }));
const place = (id: string, title: string) => ({
  placeId: id,
  visited: false,
  title,
  text: 'A saved location.',
  certainty: 'established',
  expected: 'synthetic-expected-token',
});
const map = (extra: Partial<AtlasData> = {}): AtlasData => ({
  scope: null,
  position: null,
  breadcrumb: [],
  places: [place('site', 'Warehouse'), place('office', 'Office')],
  routes: [],
  frames: [],
  nextCursor: null,
  ...extra,
});

it('selecting a destination stages editable travel through callback without sending a turn', async () => {
  const fetcher = vi.fn(async () => reply(map()));
  vi.stubGlobal('fetch', fetcher);
  const travel = vi.fn();
  render(<AtlasPanel campaignId="c1" revision={1} onTravel={travel} onSaved={vi.fn()} />);
  fireEvent.click((await screen.findAllByRole('button', { name: 'Office' }))[0]!);
  fireEvent.click(screen.getByRole('button', { name: 'Prepare travel action' }));
  expect(travel).toHaveBeenCalledExactlyOnceWith(
    'I try to travel to Office, using a known route if one is available.'
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Current position: Unknown')).toBeInTheDocument();
});

it('loads subsequent pages and deduplicates endpoints without presenting diagram spacing as distance', async () => {
  const fetcher = vi.fn(async (url: string) =>
    reply(
      url.includes('cursor=30')
        ? map({ places: [place('office', 'Office'), place('sewer', 'Sewer')], nextCursor: null })
        : map({ nextCursor: 30 })
    )
  );
  vi.stubGlobal('fetch', fetcher);
  render(<AtlasPanel campaignId="c1" revision={1} onTravel={vi.fn()} onSaved={vi.fn()} />);
  expect((await screen.findAllByRole('button', { name: 'Sewer' }))[0]!).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Office' })).toHaveLength(2);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(screen.getByText(/Diagram spacing does not represent distance/)).toBeInTheDocument();
});

it('displays closed routes and unknown distance/time instead of suggesting free traversal', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      reply(
        map({
          routes: [
            {
              id: 'r1',
              from: 'site',
              to: 'office',
              bidirectional: false,
              kind: 'door',
              access: 'locked',
              visibility: 'player',
              certainty: 'rumor',
              expected: 'synthetic-route-token',
            },
          ],
        })
      )
    )
  );
  render(<AtlasPanel campaignId="c1" revision={1} onTravel={vi.fn()} onSaved={vi.fn()} />);
  expect(
    await screen.findByText(
      /Warehouse → Office · door · locked · rumor · distance unknown · travel time unknown/
    )
  ).toBeInTheDocument();
});

it('ignores a late response from the prior campaign', async () => {
  let resolveOld!: (response: Response) => void;
  const fetcher = vi.fn(async (url: string) =>
    url.includes('/c1/')
      ? new Promise<Response>((resolve) => {
          resolveOld = resolve;
        })
      : reply(map({ places: [place('new', 'New town')] }))
  );
  vi.stubGlobal('fetch', fetcher);
  const callbacks = { onTravel: vi.fn(), onSaved: vi.fn() };
  const mounted = render(<AtlasPanel campaignId="c1" revision={1} {...callbacks} />);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  mounted.rerender(<AtlasPanel campaignId="c2" revision={1} {...callbacks} />);
  await screen.findAllByRole('button', { name: 'New town' });
  resolveOld(reply(map()));
  await waitFor(() =>
    expect(screen.queryAllByRole('button', { name: 'Warehouse' })).toHaveLength(0)
  );
});

it('campaign navigation resets old scope and hides previous campaign travel controls', async () => {
  let resolveNew!: (response: Response) => void;
  const fetcher = vi.fn(async (url: string) =>
    url.includes('/c2/')
      ? new Promise<Response>((resolve) => {
          resolveNew = resolve;
        })
      : reply(map())
  );
  vi.stubGlobal('fetch', fetcher);
  const callbacks = { onTravel: vi.fn(), onSaved: vi.fn() };
  const mounted = render(<AtlasPanel campaignId="c1" revision={1} {...callbacks} />);
  fireEvent.click((await screen.findAllByRole('button', { name: 'Office' }))[0]!);
  fireEvent.click(screen.getByRole('button', { name: 'Explore this place' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  mounted.rerender(<AtlasPanel campaignId="c2" revision={1} {...callbacks} />);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  const newRequest = fetcher.mock.calls[2]![0];
  expect(newRequest).not.toContain('scope=office');
  expect(screen.queryByRole('button', { name: 'Prepare travel action' })).not.toBeInTheDocument();
  resolveNew(reply(map({ places: [place('new', 'New town')] })));
  await screen.findAllByRole('button', { name: 'New town' });
});
