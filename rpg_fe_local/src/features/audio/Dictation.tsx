import { useEffect, useRef, useState } from 'react';
import { Mic, Square, X } from 'lucide-react';
import { request, errorMessage } from '../../services/client';
export function Dictation({
  onTranscript,
  disabled,
  language,
  maxSeconds,
}: {
  onTranscript: (text: string) => void;
  disabled: boolean;
  language: string;
  maxSeconds: number;
}) {
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    chunks = useRef<Blob[]>([]),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    generation = useRef(0),
    starting = useRef(false),
    controller = useRef<AbortController | null>(null);
  const [state, setState] = useState<'idle' | 'starting' | 'recording' | 'transcribing'>('idle'),
    [error, setError] = useState('');
  function cleanup() {
    generation.current++;
    starting.current = false;
    if (timer.current) clearTimeout(timer.current);
    controller.current?.abort();
    if (recorder.current?.state === 'recording') {
      recorder.current.onstop = null;
      recorder.current.ondataavailable = null;
      recorder.current.stop();
    }
    recorder.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    chunks.current = [];
  }
  useEffect(() => () => cleanup(), []);
  function cancel() {
    cleanup();
    setState('idle');
  }
  async function start() {
    if (starting.current || state !== 'idle') return;
    setError('');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError(
        'Microphone recording needs HTTPS (or localhost) and a supported browser. You can still type.'
      );
      return;
    }
    starting.current = true;
    setState('starting');
    const id = ++generation.current;
    try {
      const result = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (id !== generation.current) {
        result.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = result;
      chunks.current = [];
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find((type) =>
        MediaRecorder.isTypeSupported(type)
      );
      const active = new MediaRecorder(result, mime ? { mimeType: mime } : undefined);
      recorder.current = active;
      active.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      active.onstop = async () => {
        result.getTracks().forEach((t) => t.stop());
        stream.current = null;
        if (timer.current) clearTimeout(timer.current);
        if (id !== generation.current) return;
        setState('transcribing');
        const abort = new AbortController();
        controller.current = abort;
        try {
          const body = new FormData();
          const extension = active.mimeType.includes('mp4')
            ? 'm4a'
            : active.mimeType.includes('ogg')
              ? 'ogg'
              : 'webm';
          body.append(
            'file',
            new Blob(chunks.current, { type: active.mimeType }),
            `dictation.${extension}`
          );
          body.append('language', language);
          const response = await request<{ text: string }>('/audio/transcriptions', {
            method: 'POST',
            body,
            signal: abort.signal,
          });
          if (id === generation.current) onTranscript(response.text);
        } catch (e) {
          if (id === generation.current) setError(errorMessage(e));
        } finally {
          if (id === generation.current) {
            setState('idle');
            chunks.current = [];
          }
        }
      };
      active.start();
      setState('recording');
      timer.current = setTimeout(
        () => active.state === 'recording' && active.stop(),
        maxSeconds * 1000
      );
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
      if (id === generation.current) {
        setError(errorMessage(e));
        setState('idle');
      }
    } finally {
      starting.current = false;
    }
  }
  return (
    <div className="dictation">
      <button
        type="button"
        disabled={disabled || state === 'transcribing' || state === 'starting'}
        onClick={() => (state === 'recording' ? recorder.current?.stop() : void start())}
      >
        {state === 'recording' ? <Square size={16} /> : <Mic size={16} />}{' '}
        {state === 'recording'
          ? 'Stop recording'
          : state === 'transcribing'
            ? 'Transcribing…'
            : state === 'starting'
              ? 'Opening microphone…'
              : 'Dictate'}
      </button>
      {state !== 'idle' && (
        <button type="button" onClick={cancel}>
          <X size={14} />
          Discard audio
        </button>
      )}
      {state === 'recording' && (
        <span role="status">Recording • stops after {maxSeconds} seconds</span>
      )}
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
