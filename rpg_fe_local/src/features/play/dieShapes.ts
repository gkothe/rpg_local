/** Outline shapes for polyhedral dice in a 48×48 box; any other die is drawn as a round token. */
export type DieShape = { name: string; outline: string; inner?: string };

const SHAPES: Record<number, DieShape> = {
  4: { name: 'd4', outline: 'M24 5 L43 40 H5 Z' },
  6: { name: 'd6', outline: 'M9 9 H39 V39 H9 Z' },
  8: { name: 'd8', outline: 'M24 4 L42 24 L24 44 L6 24 Z', inner: 'M6 24 H42' },
  10: { name: 'd10', outline: 'M24 3 L43 19 L24 45 L5 19 Z', inner: 'M5 19 H43' },
  12: { name: 'd12', outline: 'M24 4 L43 18 L36 41 H12 L5 18 Z' },
  20: {
    name: 'd20',
    outline: 'M24 3 L42 13.5 V34.5 L24 45 L6 34.5 V13.5 Z',
    inner: 'M24 3 L33 24 L24 45 M24 3 L15 24 L24 45 M6 13.5 L33 24 M42 13.5 L15 24',
  },
};
export const TOKEN_SHAPE: DieShape = { name: 'token', outline: 'M24 4 A20 20 0 1 1 23.99 4 Z' };

export const dieShape = (sides: number): DieShape => SHAPES[sides] ?? TOKEN_SHAPE;
