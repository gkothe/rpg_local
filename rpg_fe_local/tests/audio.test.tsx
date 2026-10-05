import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { Dictation } from '../src/features/audio/Dictation';
import { ReadAloud } from '../src/features/audio/ReadAloud';
afterEach(() => vi.unstubAllGlobals());
describe('audio boundaries', () => {
  it('stops acquired tracks when recorder construction fails', async () => {
    const stop = vi.fn();
    vi.stubGlobal('isSecureContext', true);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) },
    });
    vi.stubGlobal(
      'MediaRecorder',
      class {
        static isTypeSupported() {
          return true;
        }
        constructor() {
          throw new Error('Recorder unavailable.');
        }
      }
    );
    render(<Dictation maxSeconds={60} language="auto" disabled={false} onTranscript={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dictate' }));
    await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('alert')).toHaveTextContent('Recorder unavailable.');
    expect(screen.getByRole('button', { name: 'Dictate' })).toBeEnabled();
  });
  it('offers only local voices and reconciles another message taking playback', () => {
    vi.stubGlobal('localStorage', { getItem: () => null });
    const local = { voiceURI: 'local', name: 'Installed voice', lang: 'en-US', localService: true },
      remote = { voiceURI: 'remote', name: 'Online voice', lang: 'en-US', localService: false };
    const target = new EventTarget();
    const speech = {
      getVoices: () => [local, remote],
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      cancel: vi.fn(),
      speak: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
    };
    vi.stubGlobal('speechSynthesis', speech);
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        constructor(public text: string) {}
        voice: unknown = null;
        rate = 1;
        onend: unknown = null;
        onerror: unknown = null;
      }
    );
    const view = render(
      <>
        <ReadAloud text="First message" />
        <ReadAloud text="Second message" />
      </>
    );
    for (const summary of screen.getAllByText('Read aloud')) fireEvent.click(summary);
    expect(screen.queryByText('Online voice (en-US)')).not.toBeInTheDocument();
    const rows = screen.getAllByText('Read aloud').map((node) => within(node.closest('details')!));
    fireEvent.click(rows[0].getByRole('button', { name: /^Read$/ }));
    expect(rows[0].getByRole('button', { name: 'Pause' })).toBeEnabled();
    fireEvent.click(rows[1].getByRole('button', { name: /^Read$/ }));
    expect(rows[0].getByRole('button', { name: 'Pause' })).toBeDisabled();
    expect(rows[1].getByRole('button', { name: 'Pause' })).toBeEnabled();
    expect(speech.speak.mock.calls[0][0].voice).toEqual(local);
    view.unmount();
    expect(speech.cancel).toHaveBeenCalled();
  });
});
