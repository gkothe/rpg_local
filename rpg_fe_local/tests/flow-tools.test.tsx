import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import ToolExplorer from '../src/features/flow/ToolExplorer';
it('keeps book tools visible but unavailable in default mode, and explains frozen recall', async () => {
  const select = vi.fn();
  const { rerender } = render(<ToolExplorer selected="roll_dice" onSelect={select} />);
  expect(screen.getByRole('button', { name: /rules_get/ })).toBeDisabled();
  await userEvent.click(screen.getByLabelText('Enable book tools'));
  await userEvent.click(screen.getByRole('button', { name: /rules_get/ }));
  expect(select).toHaveBeenCalledWith('rules_get');
  rerender(<ToolExplorer selected="campaign_knowledge_search" onSelect={select} />);
  expect(screen.getByRole('heading', { name: 'Frozen knowledge trace' })).toBeVisible();
  expect(screen.getByText(/No SQL is executed by this recall call/)).toBeVisible();
});
