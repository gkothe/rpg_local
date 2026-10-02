import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RuleSystemEditor from '../src/features/rules/RuleSystemEditor';
const system = {
  systemId: 'system-id',
  systemKey: 'synthetic',
  systemName: 'Synthetic system',
  kind: 'library',
  revision: 1,
  contentHash: 'a'.repeat(64),
  instructions: 'Saved instructions',
  booksAllowed: true,
  sources: [],
  populatedColumns: [],
  limits: {
    instructionsBytes: 8192,
    importFiles: 12,
    importFileBytes: 10485760,
    importBytes: 20971520,
  },
};
const response = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
afterEach(() => vi.unstubAllGlobals());
it('saving instructions preserves the open editor and retries with the same revision/request identity', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response(system))
    .mockRejectedValueOnce(new Error('Lost response'))
    .mockResolvedValueOnce(response({ ...system, revision: 2 }));
  vi.stubGlobal('fetch', fetcher);
  render(
    <MemoryRouter>
      <RuleSystemEditor id="system-id" />
    </MemoryRouter>
  );
  await screen.findByRole('heading', { name: 'Synthetic system' });
  fireEvent.change(screen.getByLabelText('GM instructions'), {
    target: { value: 'Draft instructions' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save instructions' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Save instructions' }));
  await screen.findByText('Instructions saved.');
  expect(screen.getByLabelText('GM instructions')).toHaveValue('Draft instructions');
  expect(fetcher.mock.calls[1][1].body).toEqual(fetcher.mock.calls[2][1].body);
  expect(JSON.parse(fetcher.mock.calls[2][1].body).revision).toBe(1);
});
it('multipart preview leaves Content-Type to the browser and stale publication preserves draft and preview', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response(system))
    .mockResolvedValueOnce(
      response({
        previewId: 'preview-id',
        expiresAt: new Date().toISOString(),
        source: { slug: 'original', title: 'Original synthetic book' },
        nodeCount: 2,
        replacing: false,
        warnings: ['PDF hash unknown'],
        coverage: { description: 'Original fixture', omissions: [] },
        columns: ['core_rules'],
      })
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'Rule system changed; create a new preview' }), {
        status: 409,
      })
    );
  vi.stubGlobal('fetch', fetcher);
  render(
    <MemoryRouter>
      <RuleSystemEditor id="system-id" />
    </MemoryRouter>
  );
  await screen.findByLabelText('Book package files');
  fireEvent.change(screen.getByLabelText('GM instructions'), {
    target: { value: 'Unsaved draft' },
  });
  fireEvent.change(screen.getByLabelText('Book package files'), {
    target: {
      files: [new File(['{}'], 'manifest.json'), new File(['Original text'], 'core_rules.md')],
    },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
  await screen.findByRole('button', { name: 'Publish book' });
  expect(fetcher.mock.calls[1][1].body).toBeInstanceOf(FormData);
  expect((fetcher.mock.calls[1][1].headers as Headers).has('Content-Type')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Publish book' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('GM instructions')).toHaveValue('Unsaved draft');
  expect(screen.getByRole('button', { name: 'Publish book' })).toBeInTheDocument();
});
it('protected default exposes instructions only and renders imported text safely', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        response({ ...system, booksAllowed: false, instructions: '<img src=x onerror=alert(1)>' })
      )
  );
  const view = render(
    <MemoryRouter>
      <RuleSystemEditor id="system-id" />
    </MemoryRouter>
  );
  await screen.findByLabelText('GM instructions');
  expect(screen.queryByLabelText('Book package files')).toBeNull();
  expect(view.container.querySelector('img')).toBeNull();
});
