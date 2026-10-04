import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import FlowDiagram from '../src/features/flow/FlowDiagram';
describe('Flow diagram', () => {
  it('lets keyboard users select actors and information connections', async () => {
    const select = vi.fn();
    render(<FlowDiagram selected="browser" onSelect={select} />);
    const button = screen.getByRole('button', { name: /Context builder/ });
    button.focus();
    await userEvent.keyboard('{Enter}');
    expect(select).toHaveBeenCalledWith('context');
    await userEvent.click(screen.getByRole('button', { name: /Send prompt/ }));
    expect(select).toHaveBeenCalledWith('prompt');
  });
});
