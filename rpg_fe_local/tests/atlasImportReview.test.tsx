import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AtlasImportReview from '../src/features/atlas/AtlasImportReview';
import type { AtlasData } from '../src/features/atlas/types';

afterEach(() => vi.unstubAllGlobals());
const reply = (data: unknown) => new Response(JSON.stringify({ data }));
const map: AtlasData = {
  scope: null,
  position: null,
  breadcrumb: [],
  places: [
    {
      placeId: 'old-office',
      title: 'Existing office',
      text: 'Existing layout.',
      visited: false,
      certainty: 'established',
      expected: 'test-expected',
    },
  ],
  routes: [],
  frames: [],
  nextCursor: null,
};
const job = {
  id: 'job1',
  status: 'ready',
  processing: false,
  reviewable: true,
  cancellable: true,
  restartable: true,
  applied: false,
  error: null,
  draft: {
    geography: {
      places: [{ key: 'office', title: 'Office', text: 'Image office.', certainty: 'rumor' }],
      changes: {
        routes: [
          {
            value: {
              from: { localKey: 'office' },
              to: 'outside',
              kind: 'door',
              access: 'unknown',
              certainty: 'rumor',
            },
          },
        ],
      },
    },
    observations: [{ key: 'office', uncertainty: 'The exit is unclear.' }],
  },
};
async function upload() {
  fireEvent.click(screen.getByText('Import a map image'));
  fireEvent.change(screen.getByLabelText('Map image'), {
    target: { files: [new File(['synthetic image'], 'warehouse.png', { type: 'image/png' })] },
  });
  fireEvent.submit(screen.getByRole('button', { name: 'Extract map draft' }).closest('form')!);
}

it('reviewer rejects a connection, matches a Place and keeps original image private by default', async () => {
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.body instanceof FormData ? reply(job) : reply({ saved: true })
  );
  vi.stubGlobal('fetch', fetcher);
  const saved = vi.fn(async () => {});
  render(<AtlasImportReview campaignId="c1" map={map} onSaved={saved} />);
  expect(fetcher).not.toHaveBeenCalled();
  await upload();
  await screen.findByRole('heading', { name: 'Review extracted geography' });
  await waitFor(() =>
    expect(screen.getByRole('checkbox', { name: /Accept connection/ })).toBeChecked()
  );
  fireEvent.click(screen.getByRole('checkbox', { name: /Accept connection/ }));
  fireEvent.change(screen.getByLabelText('Match existing place'), {
    target: { value: 'old-office' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Accept selected geography' }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  const decision = JSON.parse(String(fetcher.mock.calls[1]![1]!.body));
  expect(decision.selectedKeys).toEqual(['office']);
  expect(decision.selectedRoutes).toEqual([]);
  expect(decision.matches).toEqual({ office: 'old-office' });
  expect(decision.playerSafe).toBe(false);
  expect(
    screen.queryByRole('button', { name: 'Accept selected geography' })
  ).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Discard import' })).not.toBeInTheDocument();
});

it('upload retry retains request identity and leaves multipart content type browser-managed', async () => {
  const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => {
    if (fetcher.mock.calls.length === 1) throw new Error('Network interrupted');
    return reply(job);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<AtlasImportReview campaignId="c1" map={map} onSaved={async () => {}} />);
  await upload();
  expect(await screen.findByRole('alert')).toHaveTextContent('Network interrupted');
  fireEvent.submit(screen.getByRole('button', { name: 'Extract map draft' }).closest('form')!);
  await screen.findByRole('heading', { name: 'Review extracted geography' });
  const first = fetcher.mock.calls[0]![1]!,
    retry = fetcher.mock.calls[1]![1]!;
  expect((first.body as FormData).get('requestId')).toBe((retry.body as FormData).get('requestId'));
  expect(new Headers(first.headers).has('Content-Type')).toBe(false);
  expect(new Headers(retry.headers).has('Content-Type')).toBe(false);
});

it('uncertain acceptance retry retains request ID and review selections', async () => {
  let accepts = 0;
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.body instanceof FormData) return reply(job);
    accepts++;
    if (accepts === 1) throw new Error('Lost acceptance response');
    return reply({ saved: true });
  });
  vi.stubGlobal('fetch', fetcher);
  const saved = vi.fn(async () => {});
  render(<AtlasImportReview campaignId="c1" map={map} onSaved={saved} />);
  await upload();
  await screen.findByRole('heading', { name: 'Review extracted geography' });
  await waitFor(() =>
    expect(screen.getByRole('checkbox', { name: /Accept connection/ })).toBeChecked()
  );
  fireEvent.click(screen.getByRole('checkbox', { name: /Accept connection/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Accept selected geography' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Lost acceptance response');
  expect(screen.getByRole('checkbox', { name: /Accept connection/ })).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Accept selected geography' }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(fetcher.mock.calls[1]![1]!.body).toEqual(fetcher.mock.calls[2]![1]!.body);
});

it('reopens a saved ready import and preserves review edits through a status refresh', async () => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return reply({ saved: true });
    if (url.endsWith('/imports'))
      return reply({
        jobs: [{ id: job.id, status: 'ready', createdAt: '2026-10-09T12:00:00.000Z' }],
        nextCursor: null,
      });
    return reply(structuredClone(job));
  });
  vi.stubGlobal('fetch', fetcher);
  const saved = vi.fn(async () => {});
  render(<AtlasImportReview campaignId="c1" map={map} onSaved={saved} />);
  fireEvent.click(screen.getByText('Import a map image'));
  fireEvent.click(screen.getByRole('button', { name: 'Find saved image imports' }));
  fireEvent.click(await screen.findByRole('button', { name: /^ready —/ }));
  await screen.findByRole('heading', { name: 'Review extracted geography' });
  await waitFor(() =>
    expect(screen.getByRole('checkbox', { name: /Accept connection/ })).toBeChecked()
  );
  fireEvent.click(screen.getByRole('checkbox', { name: /Accept connection/ }));
  fireEvent.change(screen.getByLabelText('Match existing place'), {
    target: { value: 'old-office' },
  });
  fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed the whole image/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Check extraction status' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  expect(screen.getByRole('checkbox', { name: /Accept connection/ })).not.toBeChecked();
  expect(screen.getByLabelText('Match existing place')).toHaveValue('old-office');
  expect(screen.getByRole('checkbox', { name: /I reviewed the whole image/ })).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Accept selected geography' }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  const body = JSON.parse(String(fetcher.mock.calls[3]![1]!.body));
  expect(body.selectedRoutes).toEqual([]);
  expect(body.matches).toEqual({ office: 'old-office' });
  expect(body.playerSafe).toBe(true);
  expect(fetcher.mock.calls.filter(([, init]) => init?.body instanceof FormData)).toHaveLength(0);
});

it('server capabilities keep an imported audit draft non-reviewable and allow a genuinely fresh request', async () => {
  const audit = {
    ...job,
    status: 'ready',
    auditOnly: true,
    reviewable: false,
    cancellable: false,
    restartable: true,
    processing: false,
  };
  const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => reply(audit));
  vi.stubGlobal('fetch', fetcher);
  render(
    <AtlasImportReview
      campaignId="c1"
      map={map}
      onSaved={async () => {}}
      imageTypes={['image/png']}
    />
  );
  await upload();
  await screen.findByText(/Imported drafts are audit records/);
  expect(
    screen.queryByRole('heading', { name: 'Review extracted geography' })
  ).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Discard import' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Check extraction status' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Map image')).toHaveAttribute('accept', 'image/png');
  const originalId = (fetcher.mock.calls[0]![1]!.body as FormData).get('requestId');
  fireEvent.click(screen.getByRole('button', { name: 'Start a fresh import' }));
  expect(screen.queryByText(/Imported drafts are audit records/)).not.toBeInTheDocument();
  fireEvent.submit(screen.getByRole('button', { name: 'Extract map draft' }).closest('form')!);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect((fetcher.mock.calls[1]![1]!.body as FormData).get('requestId')).not.toBe(originalId);
});
