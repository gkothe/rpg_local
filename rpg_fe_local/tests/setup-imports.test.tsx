import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Setup from '../src/pages/Setup';
import { fixtureCampaign, options, providers } from './fixtures';

afterEach(() => vi.unstubAllGlobals());

function mount(failSecond = false) {
  const uploads: { name: string; revision: string }[] = [];
  let creates = 0;
  let campaign = fixtureCampaign();
  const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    let data: unknown = [];
    if (path === '/api/providers') data = providers;
    if (path === '/api/settings') data = options;
    if (path === '/api/campaigns') {
      creates++;
      data = campaign;
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
      campaign = {
        ...campaign,
        revision: campaign.revision + 1,
        sources: [
          ...campaign.sources,
          {
            id: `source-${uploads.length}`,
            name: uploads.at(-1)!.name,
            kind: 'file',
            text: 'Character text',
            status: 'confirmed',
            version: 1,
            pages: [],
            warnings: [],
          },
        ],
      };
      data = campaign;
    }
    if (path.endsWith('/character-drafts'))
      data = {
        draft: {
          name: 'Sigurd',
          type: 'npc',
          attributes: { health: 7 },
          inventory: { sword: 1 },
          description: { clan: 'Gangrel' },
        },
      };
    if (path.endsWith('/characters')) data = { ...campaign, revision: campaign.revision + 1 };
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
  await screen.findByRole('option', { name: providers[0].name });
  fireEvent.change(screen.getByLabelText('AI CLI'), { target: { value: providers[0].id } });
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
  const parse = app.fetcher.mock.calls.find(([path]) => path.endsWith('/character-drafts'))!;
  expect(JSON.parse(String(parse[1]!.body))).toEqual({
    revision: fixtureCampaign().revision + 3,
    sourceId: 'source-3',
  });
  const save = app.fetcher.mock.calls.find(([path]) => path.endsWith('/characters'))!;
  expect(JSON.parse(String(save[1]!.body))).toEqual({
    revision: fixtureCampaign().revision + 3,
    name: 'Sigurd',
    type: options.defaults.characterType,
    attributes: { health: 7 },
    inventory: { sword: 1 },
    description: { clan: 'Gangrel' },
  });
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

it('rejects oversized files before creating a campaign', async () => {
  const app = mount();
  await chooseFiles();
  fireEvent.change(screen.getByLabelText('Character sheet file'), {
    target: {
      files: [new File([new Uint8Array(options.limits.uploadBytes + 1)], 'character.json')],
    },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create campaign' }));
  await screen.findByText(/file exceeds the configured upload limit/);
  expect(app.creates()).toBe(0);
});

it('imports both Google Docs links using the latest revision after file uploads', async () => {
  const app = mount();
  await chooseFiles();
  fireEvent.change(screen.getByLabelText('Character sheet file'), { target: { files: [] } });
  const documents: { revision: number; url: string }[] = [];
  const original = app.fetcher.getMockImplementation()!;
  app.fetcher.mockImplementation(async (path, init) => {
    if (path.endsWith('/sources/extract') && typeof init?.body === 'string') {
      documents.push(JSON.parse(init.body));
      return new Response(
        JSON.stringify({
          data: {
            ...fixtureCampaign(),
            revision: fixtureCampaign().revision + 2 + documents.length,
            sources: documents.map((doc, index) => ({
              id: `doc-${index}`,
              name: doc.url,
              kind: 'google',
              text: 'Sheet',
              status: 'confirmed',
              version: 1,
              pages: [],
              warnings: [],
            })),
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
      revision: fixtureCampaign().revision + 2,
      url: 'https://docs.google.com/document/d/adventure/edit',
    },
    {
      revision: fixtureCampaign().revision + 3,
      url: 'https://docs.google.com/document/d/character/edit',
    },
  ]);
  const parsed = app.fetcher.mock.calls.find(([path]) => path.endsWith('/character-drafts'))!;
  expect(JSON.parse(String(parsed[1]!.body))).toEqual({
    revision: fixtureCampaign().revision + 4,
    sourceId: 'doc-1',
  });
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

it('retains the saved campaign and sheet when the selected CLI fails to parse', async () => {
  const app = mount();
  await chooseFiles();
  const original = app.fetcher.getMockImplementation()!;
  app.fetcher.mockImplementation(async (path, init) =>
    path.endsWith('/character-drafts')
      ? new Response(JSON.stringify({ detail: 'CLI quota exhausted' }), { status: 503 })
      : original(path, init)
  );
  fireEvent.click(screen.getByRole('button', { name: 'Create campaign' }));
  await screen.findByText('CLI quota exhausted');
  expect(app.uploads).toHaveLength(3);
  expect(app.creates()).toBe(1);
  expect(screen.getByRole('link', { name: 'Continue to source review' })).toBeVisible();
  expect(app.fetcher.mock.calls.some(([path]) => path.endsWith('/characters'))).toBe(false);
});

it('requires a selected CLI before creating a campaign with an automatic character import', async () => {
  const app = mount();
  await chooseFiles();
  fireEvent.change(screen.getByLabelText('AI CLI'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create campaign' }));
  await screen.findByText(/Select an AI CLI and model to automatically parse/);
  expect(app.creates()).toBe(0);
});

it('rejects two character inputs instead of guessing which is the main character', async () => {
  const app = mount();
  await chooseFiles();
  fireEvent.change(screen.getByLabelText('Character public Google Docs URL'), {
    target: { value: 'https://docs.google.com/document/d/character/edit' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create campaign' }));
  await screen.findByText(/Choose a character sheet file or a Google Docs link, not both/);
  expect(app.creates()).toBe(0);
});

it('does not save a character from a parsing response arriving after navigation', async () => {
  const app = mount();
  await chooseFiles();
  let resolve!: (response: Response) => void;
  const original = app.fetcher.getMockImplementation()!;
  app.fetcher.mockImplementation((path, init) =>
    path.endsWith('/character-drafts')
      ? new Promise<Response>((done) => {
          resolve = done;
        })
      : original(path, init)
  );
  fireEvent.click(screen.getByRole('button', { name: 'Create campaign' }));
  await waitFor(() => expect(resolve).toBeTypeOf('function'));
  app.unmount();
  resolve(
    new Response(
      JSON.stringify({
        data: { draft: { name: 'Sigurd', attributes: {}, inventory: {}, description: {} } },
      }),
      { status: 200 }
    )
  );
  await new Promise((done) => setTimeout(done, 0));
  expect(app.fetcher.mock.calls.some(([path]) => path.endsWith('/characters'))).toBe(false);
});
