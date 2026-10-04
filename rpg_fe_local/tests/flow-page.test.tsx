import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { expect, it } from 'vitest';
import Flow from '../src/pages/Flow';
it('opens a linked step, selects evidence and safely falls back from unknown selections', async () => {
  const { unmount } = render(
    <MemoryRouter initialEntries={['/flow?node=context&step=prepare']}>
      <Flow />
    </MemoryRouter>
  );
  expect(screen.getByRole('heading', { name: '4. Freeze context' })).toBeVisible();
  await userEvent.click(screen.getByText('Source code and documentation'));
  await userEvent.click(screen.getByRole('button', { name: 'Read document section 4.3' }));
  expect(screen.getByLabelText('Architecture document')).toBeVisible();
  expect(screen.getByLabelText('Document section')).toHaveValue('4.3');
  unmount();
  render(
    <MemoryRouter initialEntries={['/flow?view=unknown&node=unknown&step=unknown']}>
      <Flow />
    </MemoryRouter>
  );
  expect(screen.getByRole('heading', { name: '1. Submit an action' })).toBeVisible();
});
