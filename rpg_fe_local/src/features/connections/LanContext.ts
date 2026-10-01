import { createContext, useContext } from 'react';
import type { LanStatus } from '../../services/types';
export interface LanAccessState {
  status: LanStatus | null;
  error: string;
  refresh: () => Promise<void>;
  requirePairing: () => void;
  paired: () => void;
}
export const LanContext = createContext<LanAccessState | null>(null);
export function useLanAccess() {
  const state = useContext(LanContext);
  if (!state) throw new Error('LAN access provider missing');
  return state;
}
