import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NarratedText } from '../src/features/audio/NarratedText';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function voiceRuntime() {
  vi.stubGlobal('localStorage', { getItem: () => null });
  const target = new EventTarget();
  const speech = {
    getVoices: () => [{ voiceURI: 'local', name: 'Local', lang: 'en-US', localService: true }],
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
    }
  );
  return speech;
}
it('highlights the spoken sentence using original offsets and clears stale events on stop', () => {
  const speech = voiceRuntime();
  const text = 'Mira waits.\n\n🐉 The gate opens. What do you do?';
  const view = render(<NarratedText text={text} readable />);
  fireEvent.click(screen.getByText('Read aloud'));
  fireEvent.click(screen.getByRole('button', { name: 'Read' }));
  const utterance = speech.speak.mock.calls[0][0];
  expect(utterance.text).toBe(text);
  expect(view.container.querySelector('mark')).toBeNull();
  act(() => utterance.onboundary({ charIndex: 20 }));
  expect(view.container.querySelector('mark')).toHaveTextContent('🐉 The gate opens.');
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
  expect(view.container.querySelector('mark')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
  act(() => utterance.onboundary({ charIndex: 35 }));
  expect(view.container.querySelector('mark')).toBeNull();
});

it.each(['onend', 'onerror'])(
  'clears highlighting after %s and ignores late boundaries',
  (event) => {
    const speech = voiceRuntime();
    const view = render(<NarratedText text="Mira waits. The gate opens." readable />);
    fireEvent.click(screen.getByText('Read aloud'));
    fireEvent.click(screen.getByRole('button', { name: 'Read' }));
    const utterance = speech.speak.mock.calls[0][0];
    act(() => utterance.onboundary({ charIndex: 2 }));
    expect(view.container.querySelector('mark')).toHaveTextContent('Mira waits.');
    act(() => utterance[event]());
    act(() => utterance.onboundary({ charIndex: 15 }));
    expect(view.container.querySelector('mark')).toBeNull();
  }
);

it('switches playback between messages without an inactive message cancelling the new voice', () => {
  const speech = voiceRuntime();
  const first = render(<NarratedText text="First scene." readable />);
  const second = render(<NarratedText text="Second scene." readable />);
  const read = (container: HTMLElement) => {
    fireEvent.click(container.querySelector('summary')!);
    fireEvent.click(
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === 'Read'
      )!
    );
  };
  read(first.container);
  const oldUtterance = speech.speak.mock.calls[0][0];
  act(() => oldUtterance.onboundary({ charIndex: 0 }));
  read(second.container);
  const newUtterance = speech.speak.mock.calls[1][0];
  act(() => newUtterance.onboundary({ charIndex: 0 }));
  act(() => oldUtterance.onboundary({ charIndex: 0 }));
  expect(first.container.querySelector('mark')).toBeNull();
  expect(second.container.querySelector('mark')).toHaveTextContent('Second scene.');
  const cancellations = speech.cancel.mock.calls.length;
  first.unmount();
  expect(speech.cancel).toHaveBeenCalledTimes(cancellations);
  second.unmount();
  expect(speech.cancel).toHaveBeenCalledTimes(cancellations + 1);
});
