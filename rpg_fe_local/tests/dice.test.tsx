import { expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DiceRolls } from '../src/features/play/DiceRolls';
import type { Turn } from '../src/services/types';
test('dice chat renders immutable declarations and faces separately from GM interpretation and corrections', () => {
  const turn = {
    retryOfTurnId: 'previous',
    rolls: [
      {
        id: 'roll',
        slot: 0,
        reason: 'Climb',
        declaration: '+2 agility; target 12',
        groups: [{ label: 'Climb check', sides: 20, faces: [9] }],
      },
    ],
    rollInterpretations: [
      {
        rollId: 'roll',
        explanation: 'Total 11; failure',
        corrections: [{ explanation: 'Forgot the rope bonus; corrected total 13, success' }],
      },
    ],
  } as Turn;
  const { rerender } = render(<DiceRolls turn={turn} characters={[]} terminal={false} />);
  expect(screen.queryByLabelText('Trusted dice results')).toBeNull();
  rerender(<DiceRolls turn={turn} characters={[]} terminal />);
  expect(screen.getByText('Declared before rolling: +2 agility; target 12')).toBeVisible();
  expect(screen.getByText('9')).toBeVisible();
  expect(screen.getByText('GM interpretation: Total 11; failure')).toBeVisible();
  expect(
    screen.getByText('Correction: Forgot the rope bonus; corrected total 13, success')
  ).toBeVisible();
  expect(screen.getByText('Original rolls were preserved for this retry.')).toBeVisible();
});
