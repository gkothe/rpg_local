import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SourceManager from '../src/features/sources/SourceManager';
import { uploadSources } from '../src/features/sources/uploadSources';
import { fixtureCampaign, options } from './fixtures';

afterEach(() => vi.unstubAllGlobals());
const files = () => [new File(['rules'], 'rules.md'), new File(['sheet'], 'sheet.txt')];
const success = (revision: number) =>
  new Response(JSON.stringify({ data: { ...fixtureCampaign(), revision } }), { status: 200 });

describe('multiple source imports', () => {
  it('waits for each upload and uses the revision returned by the previous upload', async () => {
    let completeFirst!: (response: Response) => void;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            completeFirst = resolve;
          })
      )
      .mockResolvedValueOnce(success(3));
    vi.stubGlobal('fetch', fetcher);
    const result = uploadSources(fixtureCampaign(), files(), 'eng', 100, vi.fn(), () => true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((fetcher.mock.calls[0][1].body as FormData).get('revision')).toBe('1');
    completeFirst(success(2));
    expect(await result).toEqual({
      imported: ['rules.md', 'sheet.txt'],
      campaign: { ...fixtureCampaign(), revision: 3 },
      remaining: [],
      error: '',
    });
    expect((fetcher.mock.calls[1][1].body as FormData).get('revision')).toBe('2');
    expect((fetcher.mock.calls[1][1].headers as Headers).has('Content-Type')).toBe(false);
  });

  it('keeps completed imports and retains the failed file plus later files without auto retry', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(success(2))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'OCR unavailable', code: 'ocr_missing' }), {
          status: 503,
        })
      );
    vi.stubGlobal('fetch', fetcher);
    const pending = [...files(), new File(['more'], 'more.md')];
    const result = await uploadSources(fixtureCampaign(), pending, 'eng', 100, vi.fn(), () => true);
    expect(result.imported).toEqual(['rules.md']);
    expect(result.remaining.map((file) => file.name)).toEqual(['sheet.txt', 'more.md']);
    expect(result.error).toContain('sheet.txt: OCR unavailable');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not upload more files after leaving the campaign', async () => {
    let current = true;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        current = false;
        return success(2);
      })
    );
    const result = await uploadSources(
      fixtureCampaign(),
      files(),
      'eng',
      100,
      vi.fn(),
      () => current
    );
    expect(result.imported).toEqual(['rules.md']);
    expect(result.remaining.map((file) => file.name)).toEqual(['sheet.txt']);
  });

  it('exposes multiple-file and Google Docs imports, refreshes after partial failure and retains pending files', async () => {
    const refreshed = vi.fn().mockResolvedValue(undefined);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(success(2))
      .mockRejectedValueOnce(new Error('Connection lost'));
    vi.stubGlobal('fetch', fetcher);
    render(<SourceManager campaign={fixtureCampaign()} options={options} onSaved={refreshed} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add source' }));
    const input = screen.getByLabelText('Markdown, text or PDF files (select multiple)');
    expect(input).toHaveAttribute('multiple');
    expect(screen.getByLabelText('Public Google Docs URL')).toBeVisible();
    fireEvent.change(input, { target: { files: files() } });
    fireEvent.click(screen.getByRole('button', { name: 'Import selected files' }));
    await waitFor(() => expect(refreshed).toHaveBeenCalledTimes(1));
    expect(screen.getByText('sheet.txt')).toBeVisible();
    expect(screen.queryByText('rules.md')).not.toBeInTheDocument();
    expect(screen.getByText(/Earlier imports are saved/)).toBeVisible();
  });
});
