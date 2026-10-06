import { z } from 'zod';

/** TurnService owns response field validation and repair; transports keep readable JSON. */
export function nativeGameplaySchema() {
  return z.record(z.string(), z.unknown());
}
