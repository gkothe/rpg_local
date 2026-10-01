import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { request, ApiError } from '../src/services/client';
import ProviderPicker from '../src/features/providers/ProviderPicker';
import { parseObject } from '../src/services/validation';
import { providerValid as validProvider } from '../src/services/options';
import { Dictation } from '../src/features/audio/Dictation';
import type { Provider } from '../src/services/types';
const providers: Provider[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    available: true,
    supported: true,
    reason: null,
    version: 'fixture',
    models: [
      { id: 'model-a', label: 'Model A', efforts: ['low', 'high'], inputTokens: 16000 },
      { id: 'model-b', label: 'Model B', efforts: [], inputTokens: 16000 },
    ],
    catalogProvenance: 'test',
  },
];
afterEach(() => vi.unstubAllGlobals());
describe('HTTP boundary', () => {
  it('unwraps data and supplies mutation guard', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { id: 'campaign' } }), { status: 200 })
      );
    vi.stubGlobal('fetch', fetcher);
    expect(await request('/campaigns', { method: 'POST', body: '{}' })).toEqual({ id: 'campaign' });
    const headers = fetcher.mock.calls[0][1].headers as Headers;
    expect(headers.get('X-RPG-Client')).toBe('local-rpg');
    expect(headers.get('Content-Type')).toBe('application/json');
  });
  it('keeps actionable conflict details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            detail: 'Character changed while the GM was working.',
            code: 'REVISION_CONFLICT',
          }),
          { status: 409 }
        )
      )
    );
    await expect(request('/campaigns/x')).rejects.toMatchObject({
      message: 'Character changed while the GM was working.',
      status: 409,
      code: 'REVISION_CONFLICT',
    } satisfies Partial<ApiError>);
  });
});
describe('provider controls', () => {
  it('explains disabled model controls and retains unavailable provider diagnostics', () => {
    render(
      <ProviderPicker
        providers={[
          ...providers,
          {
            ...providers[0],
            id: 'missing',
            name: 'Missing CLI',
            available: false,
            reason: 'CLI not found on PATH',
          },
        ]}
        value={{ provider: '', model: '', effort: null }}
        onChange={vi.fn()}
      />
    );
    expect(
      screen.getByText('Choose an AI CLI first to unlock its models and effort options.')
    ).toBeVisible();
    expect(screen.getByText('Missing CLI: CLI not found on PATH')).toBeVisible();
    expect(screen.getByLabelText('Model')).toBeDisabled();
    expect(screen.getByLabelText('Effort')).toBeDisabled();
  });
  it('resets effort when switching to a model without efforts', () => {
    const changed = vi.fn();
    render(
      <ProviderPicker
        providers={providers}
        value={{ provider: 'claude', model: 'model-a', effort: 'high' }}
        onChange={changed}
      />
    );
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'model-b' } });
    expect(changed).toHaveBeenCalledWith({ provider: 'claude', model: 'model-b', effort: null });
  });
  it('blocks stale or unsupported provider options', () => {
    render(
      <ProviderPicker
        providers={[{ ...providers[0], supported: false, reason: 'Isolation is unavailable.' }]}
        value={{ provider: 'claude', model: 'model-a', effort: 'high' }}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByLabelText('Model')).toBeDisabled();
    expect(screen.getByLabelText('Effort')).toBeDisabled();
    expect(validProvider(providers, { provider: 'claude', model: 'unknown', effort: null })).toBe(
      false
    );
    expect(
      validProvider(providers, { provider: 'claude', model: 'model-a', effort: 'ultra' })
    ).toBe(false);
    expect(
      validProvider([{ ...providers[0], supported: false }], {
        provider: 'claude',
        model: 'model-a',
        effort: 'high',
      })
    ).toBe(false);
  });
});
describe('sheet validation', () => {
  it('rejects arrays and null rather than saving them as sheets', () => {
    expect(() => parseObject('[]')).toThrow('JSON object');
    expect(() => parseObject('null')).toThrow('JSON object');
    expect(parseObject('{"health":12}')).toEqual({ health: 12 });
  });
});
describe('dictation lifecycle', () => {
  it('guards rapid starts and stops tracks acquired after cancellation', async () => {
    let resolve!: (stream: MediaStream) => void;
    const getUserMedia = vi.fn(
      () =>
        new Promise<MediaStream>((r) => {
          resolve = r;
        })
    );
    const stop = vi.fn();
    vi.stubGlobal('isSecureContext', true);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    vi.stubGlobal(
      'MediaRecorder',
      class {
        static isTypeSupported() {
          return true;
        }
      }
    );
    render(<Dictation maxSeconds={60} language="auto" disabled={false} onTranscript={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dictate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Opening microphone…' }));
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Discard audio' }));
    resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Dictate' })).toBeEnabled();
  });
});
