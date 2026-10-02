import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RuleSystemPicker from '../src/features/rules/RuleSystemPicker';
import RuleEvidence from '../src/features/rules/RuleEvidence';
import RuleBackup from '../src/features/rules/RuleBackup';
import type { Turn } from '../src/services/types';
const response = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
afterEach(() => vi.unstubAllGlobals());
it('serves default/published/empty options and requires an explicit unresolved choice', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      response([
        { systemId: 'default', systemName: 'Model knowledge', isDefault: true, selectable: true },
        {
          systemId: 'published',
          systemName: 'Original book',
          revision: 2,
          isDefault: false,
          selectable: true,
        },
        { systemId: 'empty', systemName: 'Empty', isDefault: false, selectable: false },
      ])
    )
  );
  const changed = vi.fn();
  render(
    <MemoryRouter>
      <RuleSystemPicker
        value={null}
        onChange={changed}
        unresolved={{
          systemKey: 'missing',
          systemName: 'Missing',
          kind: 'library',
          contentHash: 'a'.repeat(64),
        }}
      />
    </MemoryRouter>
  );
  await screen.findByRole('option', { name: /Original book/ });
  expect(screen.getByRole('option', { name: /Empty/ })).toBeDisabled();
  expect(changed).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('System rules'), { target: { value: 'default' } });
  expect(changed).toHaveBeenCalledWith(null);
  fireEvent.change(screen.getByLabelText('System rules'), { target: { value: 'published' } });
  expect(changed).toHaveBeenCalledWith('published');
});
it('renders literal historical quotations and warns when the current library differs', async () => {
  const fetcher = vi.fn().mockResolvedValue(response([]));
  vi.stubGlobal('fetch', fetcher);
  const context = {
    systemId: 'system',
    systemKey: 'original',
    systemName: 'Original',
    kind: 'library',
    revision: 1,
    contentHash: 'a'.repeat(64),
  };
  const turn = {
    id: 'turn',
    campaignId: 'campaign',
    ruleContext: context,
    ruleCitations: [
      {
        receiptId: 'receipt',
        path: 'core_rules.original.check',
        quote: '<script>malicious 🐉</script>',
        source: 'original',
        systemId: 'system',
        revision: 1,
        contentHash: context.contentHash,
        precision: 'unknown',
        pdfPages: [],
        printedPages: [],
      },
    ],
    undone: true,
  } as unknown as Turn;
  const { container } = render(
    <MemoryRouter>
      <RuleEvidence turn={turn} current={{ ...context, revision: 2 }} terminal />
    </MemoryRouter>
  );
  expect(screen.getByText('<script>malicious 🐉</script>')).toBeInTheDocument();
  expect(container.querySelector('script')).toBeNull();
  expect(screen.getByText(/current library differs/)).toBeInTheDocument();
  expect(screen.getByText('Undone attempt audit')).toBeInTheDocument();
  expect(fetcher).not.toHaveBeenCalled();
});
it('private replacement requires confirmation and preserves its request identity after an uncertain failure', async () => {
  const preview = {
    previewId: 'preview',
    systemId: 'system',
    systemKey: 'original',
    systemName: 'Original',
    contentHash: 'a'.repeat(64),
    revision: 4,
    replacing: true,
    protectedDefault: false,
    books: 1,
    expiresAt: new Date().toISOString(),
    warnings: ['Private original text'],
  };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response(preview))
    .mockRejectedValueOnce(new Error('Lost response'))
    .mockResolvedValueOnce(response({ systemId: 'system', revision: 5 }));
  vi.stubGlobal('fetch', fetcher);
  const saved = vi.fn().mockResolvedValue(undefined);
  render(
    <MemoryRouter>
      <RuleBackup systemId="system" maxBytes={33554432} onRestored={saved} />
    </MemoryRouter>
  );
  fireEvent.change(screen.getByLabelText('Private backup file'), {
    target: { files: [new File(['{}'], 'original.json')] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Preview private restore' }));
  await screen.findByText('Private original text');
  expect(screen.getByRole('button', { name: 'Confirm private restore' })).toBeDisabled();
  expect(fetcher.mock.calls[0][1].body).toBeInstanceOf(FormData);
  fireEvent.click(screen.getByLabelText('Explicitly replace this existing system'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm private restore' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm private restore' }));
  await screen.findByRole('link', { name: 'Open restored library' });
  expect(fetcher.mock.calls[1][1].body).toEqual(fetcher.mock.calls[2][1].body);
  expect(saved).toHaveBeenCalledOnce();
});
