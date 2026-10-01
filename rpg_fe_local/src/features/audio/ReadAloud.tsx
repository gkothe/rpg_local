import { useEffect, useRef, useState } from 'react';
import { Volume2, Square, Pause, Play } from 'lucide-react';
export function ReadAloud({ text }: { text: string }) {
  const sequence = useRef(0);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]),
    [voice, setVoice] = useState(''),
    [rate, setRate] = useState(1),
    [state, setState] = useState<'idle' | 'playing' | 'paused'>('idle');
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const invalidate = () => {
      sequence.current++;
    };
    const update = () =>
      setVoices(window.speechSynthesis.getVoices().filter((v) => v.localService));
    const changed = () => {
      sequence.current++;
      setState('idle');
    };
    update();
    window.speechSynthesis.addEventListener('voiceschanged', update);
    window.addEventListener('rpg-speech-start', changed);
    return () => {
      invalidate();
      window.speechSynthesis.removeEventListener('voiceschanged', update);
      window.removeEventListener('rpg-speech-start', changed);
      window.speechSynthesis.cancel();
    };
  }, []);
  const stop = () => {
    window.speechSynthesis.cancel();
    setState('idle');
  };
  return (
    <details className="read-aloud">
      <summary>
        <Volume2 size={15} /> Read aloud
      </summary>
      {voices.length === 0 ? (
        <p className="muted">No installed local browser voice is available.</p>
      ) : (
        <div className="row wrap">
          <label>
            Voice{' '}
            <select value={voice} onChange={(e) => setVoice(e.target.value)}>
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          </label>
          <label>
            Speed{' '}
            <select value={rate} onChange={(e) => setRate(Number(e.target.value))}>
              {[0.75, 1, 1.25, 1.5].map((r) => (
                <option key={r} value={r}>
                  {r}×
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => {
              if (state === 'paused') {
                window.speechSynthesis.resume();
                setState('playing');
                return;
              }
              window.dispatchEvent(new Event('rpg-speech-start'));
              window.speechSynthesis.cancel();
              const token = ++sequence.current;
              const utterance = new SpeechSynthesisUtterance(text);
              utterance.voice = voices.find((v) => v.voiceURI === voice) || voices[0];
              utterance.rate = rate;
              utterance.onend = () => {
                if (token === sequence.current) setState('idle');
              };
              utterance.onerror = () => {
                if (token === sequence.current) setState('idle');
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
      )}
    </details>
  );
}
