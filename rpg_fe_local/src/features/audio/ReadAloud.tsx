import { useEffect, useRef, useState } from 'react';
import { Square, Pause, Play } from 'lucide-react';
import { readAloudPreferences, useLocalVoices } from './readAloudPreferences';
export function ReadAloud({
  text,
  onPosition,
}: {
  text: string;
  onPosition?: (position: number | null) => void;
}) {
  const sequence = useRef(0);
  const active = useRef(false);
  const voices = useLocalVoices();
  const [error, setError] = useState('');
  const [state, setState] = useState<'idle' | 'playing' | 'paused'>('idle');
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const invalidate = () => {
      sequence.current++;
    };
    const changed = () => {
      sequence.current++;
      active.current = false;
      onPosition?.(null);
      setState('idle');
    };
    window.addEventListener('rpg-speech-start', changed);
    return () => {
      invalidate();
      window.removeEventListener('rpg-speech-start', changed);
      onPosition?.(null);
      if (active.current) window.speechSynthesis.cancel();
      active.current = false;
    };
  }, [text, onPosition]);
  const stop = () => {
    sequence.current++;
    active.current = false;
    onPosition?.(null);
    window.speechSynthesis.cancel();
    setState('idle');
  };
  return (
    <div className="read-aloud" role="group" aria-label="Read aloud controls">
      {error && <p role="alert">{error}</p>}
      {voices.length === 0 && (
        <p className="muted">No installed local browser voice is available.</p>
      )}
      <div className="row wrap">
        <button
          type="button"
          disabled={voices.length === 0}
          onClick={() => {
            if (state === 'paused') {
              window.speechSynthesis.resume();
              setState('playing');
              return;
            }
            let preferences;
            try {
              preferences = readAloudPreferences();
              setError('');
            } catch {
              setError(
                'Unable to load read-aloud settings. Check your browser storage in Settings.'
              );
              return;
            }
            window.dispatchEvent(new Event('rpg-speech-start'));
            window.speechSynthesis.cancel();
            const token = ++sequence.current;
            active.current = true;
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.voice =
              voices.find((v) => v.voiceURI === preferences.voice) ||
              voices.find((v) => v.default) ||
              voices[0];
            utterance.rate = preferences.rate;
            utterance.onboundary = (event) => {
              if (
                token === sequence.current &&
                Number.isInteger(event.charIndex) &&
                event.charIndex >= 0 &&
                event.charIndex < text.length
              )
                onPosition?.(event.charIndex);
            };
            utterance.onend = () => {
              if (token === sequence.current) {
                sequence.current++;
                active.current = false;
                onPosition?.(null);
                setState('idle');
              }
            };
            utterance.onerror = () => {
              if (token === sequence.current) {
                sequence.current++;
                active.current = false;
                onPosition?.(null);
                setState('idle');
              }
            };
            window.speechSynthesis.speak(utterance);
            setState('playing');
          }}
        >
          <Play size={14} />
          {state === 'paused' ? 'Resume' : 'Read'}
        </button>
        <button
          type="button"
          disabled={state !== 'playing'}
          onClick={() => {
            window.speechSynthesis.pause();
            setState('paused');
          }}
        >
          <Pause size={14} />
          Pause
        </button>
        <button type="button" disabled={state === 'idle'} onClick={stop}>
          <Square size={14} />
          Stop
        </button>
      </div>
    </div>
  );
}
