import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import TurnWalkthrough from '../src/features/flow/TurnWalkthrough';
it('advances and resets the turn and explains interrupted recovery', async () => {
  const change = vi.fn();
  const { rerender } = render(<TurnWalkthrough step="request" onStep={change} />);
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(change).toHaveBeenCalledWith('access');
  rerender(<TurnWalkthrough step="access" onStep={change} />);
  await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
  expect(change).toHaveBeenCalledWith('request');
  await userEvent.selectOptions(screen.getByLabelText('What if…'), 'interrupted');
  expect(screen.getByText(/does not restart inference automatically/)).toBeVisible();
});
