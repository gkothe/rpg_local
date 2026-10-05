import { useEffect, useState } from 'react';

export const READ_ALOUD_STORAGE_KEY = 'rpg-read-aloud';
export const READ_ALOUD_RATES = [0.75, 1, 1.25, 1.5];
export type ReadAloudPreferences = { voice: string; rate: number };

export function readAloudPreferences(): ReadAloudPreferences {
  const saved = window.localStorage.getItem(READ_ALOUD_STORAGE_KEY);
  if (!saved) return { voice: '', rate: 1 };
  let value: unknown;
  try {
    value = JSON.parse(saved);
  } catch {
    throw new Error('Saved read-aloud settings are invalid. Choose your voice and speed again.');
  }
  const preferences = value as Partial<ReadAloudPreferences> | null;
  return {
    voice: typeof preferences?.voice === 'string' ? preferences.voice : '',
    rate: READ_ALOUD_RATES.includes(preferences?.rate ?? 0) ? preferences!.rate! : 1,
  };
}

export function useLocalVoices() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const update = () =>
      setVoices(window.speechSynthesis.getVoices().filter((voice) => voice.localService));
    update();
    window.speechSynthesis.addEventListener('voiceschanged', update);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', update);
  }, []);
  return voices;
}
