import { expect, test } from 'vitest';
import { render } from '@testing-library/react';
import { TurnNarrative } from '../src/features/play/TurnNarrative';
import type { Turn } from '../src/services/types';

const turn = {
  narrative: 'You charge.\n\nThe shield knocks you back.\n\nThe crowd roars.',
  rolls: [
    {
      id: 'attack',
      slot: 0,
      reason: 'Charge',
      declaration: 'Seven dice',
      groups: [{ label: 'Attack', sides: 10, faces: [1, 2] }],
    },
    {
      id: 'defense',
      slot: 1,
      reason: 'Shield',
      declaration: 'Two dice',
      groups: [{ label: 'Defense', sides: 10, faces: [8, 9] }],
    },
  ],
  rollInterpretations: [
    { rollId: 'defense', afterParagraph: 2, explanation: 'Hit' },
    { rollId: 'attack', afterParagraph: 1, explanation: 'Miss' },
  ],
} as Turn;

test('rolls follow linked paragraphs even when interpretations arrive in another order', () => {
  const { container } = render(
    <TurnNarrative turn={turn} characters={[]} terminal readable={false} />
  );
  const blocks = [...container.querySelectorAll('.prose, .dice-rolls')].map(
    (node) => node.textContent
  );
  expect(blocks).toHaveLength(5);
  expect(blocks[0]).toBe('You charge.');
  expect(blocks[1]).toContain('Roll 1: Charge');
  expect(blocks[1]).toContain('GM interpretation: Miss');
  expect(blocks[2]).toBe('The shield knocks you back.');
  expect(blocks[3]).toContain('Roll 2: Shield');
  expect(blocks[4]).toBe('The crowd roars.');
});

test('shared paragraph renders each roll once and unplaced legacy rolls stay at the end', () => {
  const { container, rerender } = render(
    <TurnNarrative
      turn={{
        ...turn,
        rollInterpretations: turn.rollInterpretations!.map((entry) => ({
          ...entry,
          afterParagraph: 1,
        })),
      }}
      characters={[]}
      terminal
      readable={false}
    />
  );
  expect(container.querySelectorAll('.dice-roll')).toHaveLength(2);
  expect(container.querySelectorAll('.dice-rolls')).toHaveLength(1);
  rerender(
    <TurnNarrative
      turn={{ ...turn, rollInterpretations: [] }}
      characters={[]}
      terminal
      readable={false}
    />
  );
  expect(
    [...container.querySelectorAll('.prose')].map((node) => node.textContent).join('\n\n')
  ).toBe(turn.narrative);
  expect(container.lastElementChild).toHaveClass('dice-rolls');
  rerender(
    <TurnNarrative turn={{ ...turn, narrative: null }} characters={[]} terminal readable={false} />
  );
  expect(container.querySelectorAll('.dice-roll')).toHaveLength(2);
  rerender(<TurnNarrative turn={turn} characters={[]} terminal={false} readable={false} />);
  expect(container.querySelector('.dice-rolls')).toBeNull();
});

test('missing paragraphs or an unusable index appends all results to the message', () => {
  const { container } = render(
    <TurnNarrative
      turn={{
        ...turn,
        narrative: 'A single passage.',
        rollInterpretations: turn.rollInterpretations!.map((entry) => ({
          ...entry,
          afterParagraph: 99,
        })),
      }}
      characters={[]}
      terminal
      readable={false}
    />
  );
  expect(container.firstElementChild).toHaveTextContent('A single passage.');
  expect(container.lastElementChild).toHaveClass('dice-rolls');
  expect(container.querySelectorAll('.dice-roll')).toHaveLength(2);
  expect(container.querySelector('h3')).toBeNull();
});
