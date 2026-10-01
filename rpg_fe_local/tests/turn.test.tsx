const options = {
  turnStatusOptions: [
    { id: 'pending', active: true, completed: false },
    { id: 'completed', active: false, completed: true },
  ],
} as unknown as Settings;
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTurn } from '../src/features/play/useTurn';
import type { CampaignDetail, Turn, Settings } from '../src/services/types';
const settings = { provider: 'claude', model: 'fixture', effort: null };
const campaign = { id: 'campaign', revision: 3, turns: [], settings } as unknown as CampaignDetail;
afterEach(() => vi.unstubAllGlobals());
describe('turn lifecycle', () => {
  it('preserves the dice retry identity after an uncertain response and blocks a new action', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Lost connection'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'retry', status: 'pending' } }), { status: 202 })
      );
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() => useTurn(campaign, vi.fn(), options));
    const failed = { id: 'failed', diceRetry: { available: true, reason: null } } as Turn;
    await act(async () => {
      expect(await result.current.retryDice(failed)).toBe(false);
    });
    expect(result.current.uncertainDiceRetry).toBe(true);
    await act(async () => {
      expect(await result.current.send('New action', settings)).toBe(false);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => {
      expect(await result.current.retryDice()).toBe(true);
    });
    expect(fetcher.mock.calls[1][0]).toBe(fetcher.mock.calls[0][0]);
    expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[0][1].body);
    expect(result.current.uncertainDiceRetry).toBe(false);
  });
  it('reuses the exact request after an uncertain reply and blocks a different action', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Lost connection'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'turn', status: 'pending' } }), { status: 202 })
      );
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() => useTurn(campaign, vi.fn(), options));
    await act(async () => {
      expect(await result.current.send('Original action', settings)).toBe(false);
    });
    expect(result.current.uncertainAction).toBe('Original action');
    await act(async () => {
      expect(await result.current.send('Different action', settings)).toBe(false);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => {
      expect(await result.current.retryOriginal()).toBe(true);
    });
    expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[0][1].body);
    expect(result.current.uncertainAction).toBeNull();
  });
  it('ignores a late acknowledgement after leaving the campaign', async () => {
    let resolve!: (r: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((r) => {
            resolve = r;
          })
      )
    );
    const refresh = vi.fn();
    const { result, unmount } = renderHook(() => useTurn(campaign, refresh, options));
    let sent!: Promise<boolean>;
    await act(async () => {
      sent = result.current.send('Old campaign action', settings);
    });
    unmount();
    resolve(new Response(JSON.stringify({ data: { id: 'late', status: 'completed' } })));
    expect(await sent).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });
  it('prevents duplicate sends and captures revision/settings', async () => {
    let resolve!: (r: Response) => void;
    const fetcher = vi.fn(
      (_url: string, _options: RequestInit) =>
        new Promise<Response>((r) => {
          resolve = r;
        })
    );
    vi.stubGlobal('fetch', fetcher);
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useTurn(campaign, refresh, options));
    let first!: Promise<boolean>;
    await act(async () => {
      first = result.current.send('Open the door', settings);
      expect(await result.current.send('Open the door', settings)).toBe(false);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetcher.mock.calls[0][1].body));
    expect(body).toMatchObject({ revision: 3, action: 'Open the door', settings });
    expect(body.requestId).toMatch(/^[a-f\d-]{36}$/);
    await act(async () => {
      resolve(
        new Response(
          JSON.stringify({
            data: { id: 'turn', status: 'pending', settings } satisfies Partial<Turn>,
          }),
          { status: 202 }
        )
      );
      await first;
    });
    expect(result.current.busy).toBe(true);
  });
  it('keeps failed submission retryable and reports conflict', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ detail: 'The campaign has changed.' }), { status: 409 })
        )
    );
    const { result } = renderHook(() => useTurn(campaign, vi.fn(), options));
    await act(async () => {
      expect(await result.current.send('Keep my action', settings)).toBe(false);
    });
    await waitFor(() => expect(result.current.error).toBe('The campaign has changed.'));
    expect(result.current.busy).toBe(false);
  });
});
