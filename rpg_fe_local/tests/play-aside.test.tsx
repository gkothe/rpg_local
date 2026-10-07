import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import PlayAside from '../src/features/play/PlayAside';
import { CHRONICLE_RECORDS_PER_KIND } from '../src/features/play/asideModel';
import type { CampaignKnowledge } from '../src/services/types';
import { fixtureCampaign, options } from './fixtures';

const kinds = [
  { id: 'person', label: 'People' },
  { id: 'place', label: 'Places' },
  { id: 'event', label: 'Events' },
];
const settings = { ...options, knowledgeKindOptions: kinds };
const record = (id: number, kind: string, title: string): CampaignKnowledge =>
  ({
    id: `k${id}`,
    kind,
    title,
    updatedAt: `2026-09-30T12:${String(id).padStart(2, '0')}:00Z`,
  }) as CampaignKnowledge;
const campaign = () => {
  const base = fixtureCampaign();
  base.characters = [
    {
      ...base.characters[0],
      id: 'player-1',
      name: 'Sigurd',
      type: 'player',
      attributes: { hp: { current: 31, max: 38 }, wounds: 4, label: 'x' },
    },
    { ...base.characters[0], id: 'npc-1', name: 'Marta', type: 'npc' },
  ];
  return base;
};

describe('play aside', () => {
  it('lists players with tracks only from track hints', () => {
    const view = campaign();
    render(
      <PlayAside
        campaign={view}
        options={settings}
        layout={{
          fields: [
            {
              path: ['attributes', 'hp', 'current'],
              widget: 'track',
              maxPath: ['attributes', 'hp', 'max'],
              label: 'Hit points',
            },
          ],
        }}
      />
    );
    const party = screen.getByRole('region', { name: 'Party' });
    expect(within(party).getByText('Sigurd')).toBeVisible();
    expect(within(party).queryByText('Marta')).toBeNull();
    expect(within(party).getByText('31 / 38')).toBeVisible();
    expect(within(party).queryByText('wounds')).toBeNull();
  });
  it('shows no tracks without a layout or an encounter', () => {
    render(<PlayAside campaign={campaign()} options={settings} />);
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.queryByText('Hit points')).toBeNull();
  });
  it('resolves active encounter fields under attributes', () => {
    const view = campaign();
    view.state = {
      combat: {
        id: 'e',
        active: true,
        round: 1,
        participants: [
          {
            characterId: 'player-1',
            label: 'Sigurd',
            trackedFields: [{ path: ['wounds'], kind: 'damage', label: 'Wounds taken' }],
          },
        ],
      },
    };
    render(<PlayAside campaign={view} options={settings} />);
    const party = screen.getByRole('region', { name: 'Party' });
    expect(within(party).getByText('Wounds taken')).toBeVisible();
    expect(within(party).getByText('4')).toBeVisible();
  });
  it('ignores an ended encounter', () => {
    const view = campaign();
    view.state = {
      combat: {
        id: 'e',
        active: false,
        round: 1,
        participants: [
          {
            characterId: 'player-1',
            label: 'Sigurd',
            trackedFields: [{ path: ['wounds'], kind: 'damage', label: 'Wounds taken' }],
          },
        ],
      },
    };
    render(<PlayAside campaign={view} options={settings} />);
    expect(screen.queryByText('Wounds taken')).toBeNull();
  });
  it('hides nulls, combat, objects and long text from the scene and omits it when empty', () => {
    const view = campaign();
    view.state = {
      combat: { active: false },
      location: 'Old mill',
      weather: null,
      nested: { a: 1 },
    };
    const { rerender } = render(<PlayAside campaign={view} options={settings} />);
    const scene = screen.getByRole('region', { name: 'Scene' });
    expect(
      within(scene)
        .getAllByRole('term')
        .map((term) => term.textContent)
    ).toEqual(['location']);
    expect(within(scene).getByText('Old mill')).toBeVisible();
    view.state = { weather: null, long: 'x'.repeat(200), combat: {} };
    rerender(<PlayAside campaign={{ ...view }} options={settings} />);
    expect(screen.queryByRole('region', { name: 'Scene' })).toBeNull();
  });
  it('lists served knowledge kinds in order, newest five each, and omits empty ones', () => {
    const view = campaign();
    view.knowledge = [
      ...Array.from({ length: CHRONICLE_RECORDS_PER_KIND + 2 }, (_, index) =>
        record(index, 'place', `Place ${index}`)
      ),
      record(40, 'person', 'Old Hob'),
    ];
    render(<PlayAside campaign={view} options={settings} />);
    const chronicle = screen.getByRole('region', { name: 'Chronicle' });
    const headings = within(chronicle).getAllByRole('heading', { level: 4 });
    expect(headings.map((heading) => heading.textContent)).toEqual(['People', 'Places']);
    const places = within(chronicle).getAllByRole('list')[1]!;
    expect(
      within(places)
        .getAllByRole('listitem')
        .map((item) => item.textContent)
    ).toEqual(['Place 6', 'Place 5', 'Place 4', 'Place 3', 'Place 2']);
  });
  it('omits every section when there is nothing to show', () => {
    const view = fixtureCampaign();
    view.characters = view.characters.map((character) => ({ ...character, type: 'npc' }));
    const { container } = render(<PlayAside campaign={view} options={settings} />);
    expect(container).toBeEmptyDOMElement();
  });
});
