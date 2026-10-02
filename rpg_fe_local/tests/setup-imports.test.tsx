import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Setup from '../src/pages/Setup';
import { fixtureCampaign, options, providers } from './fixtures';

afterEach(() => vi.unstubAllGlobals());

function mount(failSecond = false) {
  const uploads: { name: string; revision: string }[] = [];
  let creates = 0;
  const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    let data: unknown = [];
    if (path === '/api/providers') data = providers;
    if (path === '/api/settings') data = options;
    if (path === '/api/campaigns') {
      creates++;
      data = fixtureCampaign();
    }
    if (path.endsWith('/sources/extract')) {
      const body = init!.body as FormData;
      uploads.push({
        name: (body.get('file') as File).name,
        revision: String(body.get('revision')),
      });
      if (failSecond && uploads.length === 2) {
        return new Response(JSON.stringify({ detail: 'OCR unavailable' }), { status: 503 });
      }
      data = { ...fixtureCampaign(), revision: fixtureCampaign().revision + uploads.length };
    }
    return new Response(JSON.stringify({ data }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetcher);
  const view = render(
    <MemoryRouter initialEntries={['/new']}>
      <Routes>
        <Route path="/new" element={<Setup />} />
        <Route path="/campaigns/:id" element={<p>Review imported sources</p>} />
      </Routes>
    </MemoryRouter>
  );
  return { ...view, uploads, fetcher, creates: () => creates };
}

async function chooseFiles() {
  await screen.findByLabelText('PDF OCR language');
  fireEvent.change(screen.getByLabelText('Campaign name'), { target: { value: 'Vampire' } });
  fireEvent.change(screen.getByLabelText('Campaign files (select multiple)'), {
    target: {
      files: [new File(['adventure'], 'campaign.md'), new File(['setting'], 'setting.txt')],
    },
  });
  fireEvent.change(screen.getByLabelText('Character sheet file'), {
    target: { files: [new File(['character'], 'character.pdf')] },
  });
}

it('imports campaign files and a separate character sheet in revision order, then opens review', async () => {
  const app = mount();
  await chooseFiles();
  expect(app.uploads).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Create campaign' }));
  await screen.findByText('Review imported sources');
  expect(app.creates()).toBe(1);
  expect(app.uploads).toEqual([
    { name: 'campaign.md', revision: String(fixtureCampaign().revision) },
    { name: 'setting.txt', revision: String(fixtureCampaign().revision + 1) },
    { name: 'character.pdf', revision: String(fixtureCampaign().revision + 2) },
  ]);
  expect(app.fetcher.mock.calls.some(([path]) => path.includes('character-drafts'))).toBe(false);
});

it('stops a failed batch and offers the saved campaign without creating duplicates or auto-retrying', async () => {
  const app = mount(true);
  await chooseFiles();
  fireEvent.click(screen.getByRole('button', { name: 'Create campaign' }));
  await screen.findByText(/OCR unavailable/);
  expect(app.uploads.map((item) => item.name)).toEqual(['campaign.md', 'setting.txt']);
  expect(screen.getByRole('button', { name: 'Create campaign' })).toBeDisabled();
  fireEvent.click(screen.getByRole('link', { name: 'Continue to source review' }));
  await screen.findByText('Review imported sources');
  expect(app.creates()).toBe(1);
});

it('rejects unsupported files before creating a campaign', async () => {
  const app = mount();
  await chooseFiles();
  fireEvent.change(screen.getByLabelText('Character sheet file'), {
    target: { files: [new File(['bad'], 'character.exe')] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create campaign' }));
  await screen.findByText(/choose Markdown, text or PDF/);
  expect(app.creates()).toBe(0);
});

it('imports both Google Docs links using the latest revision after file uploads', async () => {
  const app = mount();
  await chooseFiles();
  const documents: { revision: number; url: string }[] = [];
  const original = app.fetcher.getMockImplementation()!;
  app.fetcher.mockImplementation(async (path, init) => {
    if (path.endsWith('/sources/extract') && typeof init?.body === 'string') {
      documents.push(JSON.parse(init.body));
      return new Response(
        JSON.stringify({
          data: {
            ...fixtureCampaign(),
            revision: fixtureCampaign().revision + 3 + documents.length,
          },
        }),
        { status: 200 }
      );
    }
    return original(path, init);
  });
  fireEvent.change(screen.getByLabelText('Campaign public Google Docs URL'), {
    target: { value: 'https://docs.google.com/document/d/adventure/edit' },
  });
  fireEvent.change(screen.getByLabelText('Character public Google Docs URL'), {
    target: { value: 'https://docs.google.com/document/d/character/edit' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create campaign' }));
  await screen.findByText('Review imported sources');
  expect(documents).toEqual([
    {
      revision: fixtureCampaign().revision + 3,
      url: 'https://docs.google.com/document/d/adventure/edit',
    },
    {
      revision: fixtureCampaign().revision + 4,
      url: 'https://docs.google.com/document/d/character/edit',
    },
  ]);
});

it('does not continue uploading after navigating away', async () => {
  const app = mount();
  await chooseFiles();
  let resolve!: (response: Response) => void;
  app.fetcher.mockImplementationOnce(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Create campaign' }));
  await waitFor(() => expect(resolve).toBeTypeOf('function'));
  app.unmount();
  resolve(new Response(JSON.stringify({ data: fixtureCampaign() }), { status: 200 }));
  await waitFor(() => expect(app.uploads).toEqual([]));
});
