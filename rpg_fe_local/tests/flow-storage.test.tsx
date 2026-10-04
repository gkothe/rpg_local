import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import StorageExplorer from '../src/features/flow/StorageExplorer';
it('distinguishes surviving audit from state changes and models an undo conflict', async () => {
  render(<StorageExplorer selected="campaigns" onSelect={vi.fn()} />);
  await userEvent.selectOptions(screen.getByLabelText('Outcome'), 'invalid');
  expect(screen.getByRole('status')).toHaveTextContent('HP remains 10');
  expect(screen.getByText(/keeps any dice results and rule-read records/)).toBeVisible();
  await userEvent.selectOptions(screen.getByLabelText('Outcome'), 'undo');
  await userEvent.click(screen.getByLabelText('Later edit changed a touched field'));
  expect(screen.getByRole('status')).toHaveTextContent('Undo blocked');
  await userEvent.click(screen.getByText('Audio'));
  expect(screen.getByText(/Local FasterWhisper/)).toBeVisible();
});
