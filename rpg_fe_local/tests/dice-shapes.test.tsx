import { expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DiceRolls } from '../src/features/play/DiceRolls';
import { dieShape, TOKEN_SHAPE } from '../src/features/play/dieShapes';
import type { Turn } from '../src/services/types';

const turn = {
  rolls: [
    {
      id: 'roll',
      slot: 0,
      reason: 'Fight',
      declaration: 'target 8',
      groups: [
        { label: 'Attack', sides: 10, faces: [3, 7] },
        { label: 'Odd die', sides: 7, faces: [5] },
        { label: 'Fate', sides: 20, faces: [18] },
      ],
    },
  ],
} as Turn;

test('each roll group draws a die shape chosen by sides with every face and the group text', () => {
  const { container } = render(<DiceRolls turn={turn} characters={[]} terminal />);
  expect(screen.getByText('Attack')).toBeVisible();
  expect(screen.getByText(/2d10/)).toBeVisible();
  for (const face of ['3', '7', '5', '18']) expect(screen.getByText(face)).toBeVisible();
  const dice = [...container.querySelectorAll('.die')];
  expect(dice.map((die) => [die.getAttribute('data-sides'), die.className])).toEqual([
    ['10', 'die die-d10'],
    ['10', 'die die-d10'],
    ['7', 'die die-token'],
    ['20', 'die die-d20'],
  ]);
  expect(screen.getByRole('img', { name: 'faces 3, 7' })).toBeInTheDocument();
});

test('polyhedral sides map to distinct outlines and unknown sides to a token', () => {
  const outlines = [4, 6, 8, 10, 12, 20].map((sides) => dieShape(sides).outline);
  expect(new Set(outlines).size).toBe(6);
  expect(dieShape(100)).toBe(TOKEN_SHAPE);
  expect(dieShape(2)).toBe(TOKEN_SHAPE);
});
