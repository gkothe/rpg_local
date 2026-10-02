import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import CharacterData from '../src/features/characters/CharacterData';

describe('readable character data', () => {
  it('shows nested skills and equipment without JSON syntax or interpreting HTML', () => {
    const { container } = render(
      <CharacterData
        value={{
          physical_skills: { melee: 3 },
          equipment: [{ itemName: 'Silver sword', quantity: 1 }],
          notes: '<script>private text</script>',
          unknown: null,
        }}
      />
    );
    expect(screen.getByText('physical skills')).toBeVisible();
    expect(screen.getByText('melee')).toBeVisible();
    expect(screen.getByText('3')).toBeVisible();
    expect(screen.getByText('item Name')).toBeVisible();
    expect(screen.getByText('Silver sword')).toBeVisible();
    expect(screen.getByText('<script>private text</script>')).toBeVisible();
    expect(screen.getByText('—')).toBeVisible();
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).not.toContain('{');
  });
});
