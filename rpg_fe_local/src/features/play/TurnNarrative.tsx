import type { ReactNode } from 'react';
import type { Character, Turn } from '../../services/types';
import { NarratedText } from '../audio/NarratedText';
import { DiceRolls } from './DiceRolls';

export function TurnNarrative({
  turn,
  characters,
  terminal,
  readable,
}: {
  turn: Turn;
  characters: Character[];
  terminal: boolean;
  readable: boolean;
}) {
  const text = turn.narrative ?? '';
  const count = text.trim().split(/\r?\n\s*\r?\n/).length;
  const placed = new Map<number, NonNullable<Turn['rolls']>>();
  const unplaced: NonNullable<Turn['rolls']> = [];
  for (const roll of terminal ? (turn.rolls ?? []) : []) {
    const paragraph = turn.rollInterpretations?.find(
      (entry) => entry.rollId === roll.id
    )?.afterParagraph;
    if (
      text &&
      paragraph !== undefined &&
      Number.isInteger(paragraph) &&
      paragraph > 0 &&
      paragraph <= count
    ) {
      const rolls = placed.get(paragraph) ?? [];
      rolls.push(roll);
      placed.set(paragraph, rolls);
    } else unplaced.push(roll);
  }
  if (text && unplaced.length > 0) {
    placed.set(count, [...(placed.get(count) ?? []), ...unplaced]);
  }
  const afterParagraph = new Map<number, ReactNode>();
  for (const [paragraph, rolls] of placed)
    afterParagraph.set(
      paragraph,
      <DiceRolls turn={{ ...turn, rolls }} characters={characters} terminal={terminal} />
    );
  return (
    <>
      <NarratedText text={text} readable={readable} afterParagraph={afterParagraph} />
      {!text && unplaced.length > 0 && (
        <DiceRolls
          turn={{ ...turn, rolls: unplaced }}
          characters={characters}
          terminal={terminal}
        />
      )}
    </>
  );
}
