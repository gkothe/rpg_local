import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import RuleBrowser from '../src/features/rules/RuleBrowser';
import type { RuleSystemMetadata } from '../src/services/types';
const system: RuleSystemMetadata = {
  systemId: 'system-id',
  systemKey: 'synthetic',
  systemName: 'Synthetic',
  kind: 'library',
  revision: 1,
  contentHash: 'a'.repeat(64),
  instructions: '',
  booksAllowed: true,
  limits: {
    instructionsBytes: 8192,
    importFiles: 12,
    importFileBytes: 10485760,
    importBytes: 20971520,
    backupBytes: 33554432,
  },
  sources: [{ slug: 'original', title: 'Original synthetic book', pageCount: 2, pdfHash: null }],
  populatedColumns: ['core_rules'],
};
const response = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
afterEach(() => vi.unstubAllGlobals());
it('navigates a search locator and bounded text pages, preserving Unicode and safe literal text', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      response({
        entries: [
          {
            path: 'core_rules.original.check',
            name: 'Check',
            locator: 'locator',
            pages: { precision: 'approximate', pdfPages: [1, 2], printedPages: ['3-4'] },
          },
        ],
        cursor: null,
      })
    )
    .mockResolvedValueOnce(
      response({
        path: 'core_rules.original.check',
        text: '<script>alert(1)</script> 🐉',
        start: 20000,
        end: 20030,
        revision: 1,
        cursor: 'next',
        omitted: true,
        pages: { precision: 'unknown', pdfPages: [], printedPages: [] },
      })
    )
    .mockResolvedValueOnce(
      response({
        path: 'core_rules.original.check',
        text: 'Continuation',
        start: 20030,
        end: 20042,
        revision: 1,
        cursor: null,
        complete: true,
      })
    );
  vi.stubGlobal('fetch', fetcher);
  const view = render(<RuleBrowser system={system} />);
  fireEvent.change(screen.getByLabelText('Search rules'), { target: { value: 'check' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await screen.findByRole('button', { name: 'Read Check' });
  expect(screen.getByText(/approximate PDF pages/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Read Check' }));
  await screen.findByText('<script>alert(1)</script> 🐉');
  expect(view.container.querySelector('script')).toBeNull();
  expect(fetcher.mock.calls[1][0]).toContain('locator=locator');
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  await screen.findByText('Continuation');
  expect(fetcher.mock.calls[2][0]).toContain('cursor=next');
  expect(fetcher.mock.calls[2][0]).not.toContain('locator=');
});
it('browses direct children on demand and displays a stale cursor error without inventing results', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      response({
        entries: [{ path: 'core_rules.original.check', name: 'Check' }],
        cursor: 'stale',
        omitted: true,
      })
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          detail: 'Rule system changed; restart this lookup',
          code: 'rules_context_changed',
        }),
        { status: 409 }
      )
    );
  vi.stubGlobal('fetch', fetcher);
  render(<RuleBrowser system={system} />);
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Browse children' }));
  await screen.findByRole('button', { name: 'Read Check' });
  expect(fetcher.mock.calls[0][0]).toContain('view=children');
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Rule system changed'));
  expect(screen.getByRole('button', { name: 'Read Check' })).toBeInTheDocument();
});
