import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SheetLayoutEditor from '../src/features/rules/SheetLayoutEditor';
import type { SheetLayoutOptions } from '../src/services/types';

const options: SheetLayoutOptions = {
  widgets: [
    {
      id: 'dots',
      label: 'Dots',
      description: 'A rating shown as dots.',
      params: { max: { min: 1, max: 10, required: true } },
    },
    { id: 'rune', label: 'Rune', description: 'Served-only widget.', params: {} },
  ],
  limits: { fields: 200, bytes: 32768, labelChars: 80, pathSegments: 16 },
};
const layout = { fields: [{ path: ['attributes', 'skills'], widget: 'dots', max: 5 }] };
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(status === 200 ? { data } : data), { status });
afterEach(() => vi.unstubAllGlobals());
const mount = () =>
  render(<SheetLayoutEditor systemId="system-id" layout={layout} options={options} />);
const body = (fetcher: ReturnType<typeof vi.fn>, call: number) =>
  JSON.parse(fetcher.mock.calls[call][1].body as string);

describe('sheet layout editor', () => {
  it('saves the edited layout and stays open', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ sheetLayout: { fields: [] } }));
    vi.stubGlobal('fetch', fetcher);
    mount();
    const editor = screen.getByLabelText('Sheet layout JSON');
    expect(JSON.parse((editor as HTMLTextAreaElement).value)).toEqual(layout);
    fireEvent.change(editor, { target: { value: '{"fields":[]}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save sheet layout' }));
    await screen.findByText('Sheet layout saved.');
    expect(fetcher.mock.calls[0][0]).toBe('/api/rule-systems/system-id/sheet-layout');
    expect(fetcher.mock.calls[0][1].method).toBe('PUT');
    expect(body(fetcher, 0)).toEqual({
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      sheetLayout: { fields: [] },
    });
    expect(screen.getByLabelText('Sheet layout JSON')).toHaveValue('{"fields":[]}');
  });
  it('shows the backend validation message and keeps the draft', async () => {
    const draft = '{"fields":[{"path":["attributes","a"],"widget":"dots"}]}';
    const fetcher = vi.fn().mockResolvedValue(
      response(
        {
          code: 'sheet_layout_invalid',
          detail: 'Invalid sheet layout: sheetLayout.fields.0.max: max is required',
        },
        422
      )
    );
    vi.stubGlobal('fetch', fetcher);
    mount();
    fireEvent.change(screen.getByLabelText('Sheet layout JSON'), { target: { value: draft } });
    fireEvent.click(screen.getByRole('button', { name: 'Save sheet layout' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('fields.0.max: max is required');
    expect(screen.getByLabelText('Sheet layout JSON')).toHaveValue(draft);
  });
  it('rejects malformed JSON without a request', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    mount();
    fireEvent.change(screen.getByLabelText('Sheet layout JSON'), { target: { value: '{' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save sheet layout' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('valid JSON');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('retries an uncertain save with the same request identity', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('Lost response'))
      .mockResolvedValueOnce(response({ sheetLayout: layout }));
    vi.stubGlobal('fetch', fetcher);
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Save sheet layout' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Save sheet layout' }));
    await screen.findByText('Sheet layout saved.');
    expect(body(fetcher, 1).requestId).toBe(body(fetcher, 0).requestId);
  });
  it('lists the served widgets only', () => {
    vi.stubGlobal('fetch', vi.fn());
    mount();
    expect(screen.getByText('A rating shown as dots.')).toBeInTheDocument();
    expect(screen.getByText('Served-only widget.')).toBeInTheDocument();
    expect(screen.getByText('max 1–10 (required)')).toBeInTheDocument();
  });
  it('reloads the saved layout over an unfinished edit', () => {
    mount();
    fireEvent.change(screen.getByLabelText('Sheet layout JSON'), { target: { value: 'draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved layout' }));
    const editor = screen.getByLabelText('Sheet layout JSON') as HTMLTextAreaElement;
    expect(JSON.parse(editor.value)).toEqual(layout);
  });
});
