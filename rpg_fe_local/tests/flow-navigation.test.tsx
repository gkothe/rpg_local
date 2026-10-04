import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it } from 'vitest';
import App from '../src/App';
it('exposes a real active global Flow link and loads the guide', async () => {
  render(
    <MemoryRouter initialEntries={['/flow']}>
      <App />
    </MemoryRouter>
  );
  const link = screen.getByRole('link', { name: 'Flow' });
  expect(link).toHaveAttribute('href', '/flow');
  expect(link).toHaveAttribute('aria-current', 'page');
  expect(await screen.findByRole('heading', { name: 'Follow the Flow' })).toBeVisible();
});
