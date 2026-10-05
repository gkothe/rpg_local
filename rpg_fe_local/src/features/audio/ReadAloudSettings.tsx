import { useState } from 'react';
import {
  readAloudPreferences,
  READ_ALOUD_RATES,
  READ_ALOUD_STORAGE_KEY,
  useLocalVoices,
  type ReadAloudPreferences,
} from './readAloudPreferences';

export default function ReadAloudSettings() {
  const voices = useLocalVoices();
  const [initial] = useState(() => {
    try {
      return { preferences: readAloudPreferences(), error: '' };
    } catch (error) {
      return { preferences: { voice: '', rate: 1 }, error: String(error) };
    }
  });
  const [preferences, setPreferences] = useState(initial.preferences);
  const [error, setError] = useState(initial.error);
  function save(next: ReadAloudPreferences) {
    setPreferences(next);
    try {
      window.localStorage.setItem(READ_ALOUD_STORAGE_KEY, JSON.stringify(next));
      setError('');
    } catch {
      setError('Unable to save read-aloud settings in this browser.');
    }
  }
  const available = voices.some((voice) => voice.voiceURI === preferences.voice);
  return (
    <>
      <h3>Read aloud</h3>
      <p className="muted">
        Voice and speed are saved automatically in this browser and used for every GM response. Only
        installed local voices are offered.
      </p>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      <label className="field">
        <span>Voice</span>
        <select
          value={available ? preferences.voice : ''}
          disabled={voices.length === 0}
          onChange={(event) => save({ ...preferences, voice: event.target.value })}
        >
          <option value="">Default local voice</option>
          {voices.map((voice) => (
            <option key={voice.voiceURI} value={voice.voiceURI}>
              {voice.name} ({voice.lang})
            </option>
          ))}
        </select>
      </label>
      {voices.length === 0 && (
        <p className="muted">No installed local browser voice is available.</p>
      )}
      {preferences.voice && !available && voices.length > 0 && (
        <p className="muted">
          The saved voice is unavailable. Playback uses the default local voice.
        </p>
      )}
      <label className="field">
        <span>Speed</span>
        <select
          value={preferences.rate}
          onChange={(event) => save({ ...preferences, rate: Number(event.target.value) })}
        >
          {READ_ALOUD_RATES.map((rate) => (
            <option key={rate} value={rate}>
              {rate}×
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
