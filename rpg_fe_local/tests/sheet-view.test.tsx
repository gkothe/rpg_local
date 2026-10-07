import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import SheetView from '../src/features/characters/SheetView';
import type { SheetFieldHint } from '../src/services/types';

const sections = {
  attributes: {
    skills: { Brawl: 2 },
    hp: { current: 31, max: 38 },
    str: 16,
    strMod: 3,
    languages: ['Common'],
    gear: [{ name: 'Silver sword', damage: '1d8' }],
    flavour: 'line one\nline two',
    mood: 'calm',
    mystery: [1, { a: 1 }],
  },
  inventory: {},
  description: {},
};
const view = (fields: SheetFieldHint[] = [], data: Record<string, unknown> = sections) =>
  render(<SheetView section="attributes" sections={data} layout={{ fields }} />);

describe('sheet view', () => {
  it('shows plain numbers, tags and item cards without a layout', () => {
    const { container } = view();
    expect(screen.getByText('16')).toBeVisible();
    expect(screen.getByText('Common')).toBeVisible();
    expect(screen.getByText('Silver sword')).toBeVisible();
    expect(screen.getByText('1d8')).toBeVisible();
    expect(container.querySelector('.sheet-pips')).toBeNull();
    expect(container.querySelector('[role="meter"]')).toBeNull();
  });
  it('draws dots with an accessible label', () => {
    view([{ path: ['attributes', 'skills'], widget: 'dots', max: 5 }]);
    expect(screen.getByRole('img', { name: 'Brawl 2 of 5' })).toBeVisible();
  });
  it('draws a track as value / maximum', () => {
    view([
      {
        path: ['attributes', 'hp', 'current'],
        widget: 'track',
        maxPath: ['attributes', 'hp', 'max'],
      },
    ]);
    expect(screen.getByText('31 / 38')).toBeVisible();
    expect(screen.getByRole('meter', { name: 'current' })).toHaveAttribute('aria-valuenow', '31');
  });
  it('shows a score with its modifier', () => {
    view([
      { path: ['attributes', 'str'], widget: 'score', modifierPath: ['attributes', 'strMod'] },
    ]);
    expect(screen.getByText('+3')).toBeVisible();
  });
  it('keeps prose line breaks', () => {
    view([{ path: ['attributes', 'flavour'], widget: 'prose' }]);
    expect(screen.getByText(/line one/)).toHaveStyle({ whiteSpace: 'pre-line' });
  });
  it('explains a hint that does not fit and still shows the value', () => {
    view([{ path: ['attributes', 'mood'], widget: 'dots', max: 5 }]);
    expect(screen.getByText('calm')).toBeVisible();
    expect(screen.getByText('Layout hint does not fit this value.')).toBeVisible();
  });
  it('renders values as literal text, never HTML', () => {
    const { container } = view([], {
      attributes: { note: '<script>alert(1)</script>', gear: [{ name: '<b>bold</b>' }] },
    });
    expect(screen.getByText('<script>alert(1)</script>')).toBeVisible();
    expect(screen.getByText('<b>bold</b>')).toBeVisible();
    expect(container.querySelector('script, b')).toBeNull();
  });
  it('delegates raw nodes to the generic data view', () => {
    view();
    expect(
      screen.getByText('mystery').closest('.sheet-field')!.querySelector('.character-data-list')
    ).not.toBeNull();
  });
  it('says so when a section is empty', () => {
    render(<SheetView section="inventory" sections={sections} />);
    expect(screen.getByText('Nothing recorded.')).toBeVisible();
  });
});
