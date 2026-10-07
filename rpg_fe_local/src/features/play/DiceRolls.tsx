import type { Character, Turn } from '../../services/types';
import { dieShape } from './dieShapes';

function Die({ sides, face }: { sides: number; face: number }) {
  const shape = dieShape(sides);
  return (
    <span className={`die die-${shape.name}`} data-sides={sides}>
      <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        <path className="die-outline" d={shape.outline} />
        {shape.inner && <path className="die-inner" d={shape.inner} />}
      </svg>
      <span className="die-face">{face}</span>
    </span>
  );
}
export function DiceRolls({
  turn,
  characters,
  terminal,
}: {
  turn: Turn;
  characters: Character[];
  terminal: boolean;
}) {
  if (!terminal || !turn.rolls?.length) return null;
  return (
    <section className="dice-rolls" aria-label="Trusted dice results">
      {turn.retryOfTurnId && <p className="muted">Original rolls were preserved for this retry.</p>}
      {turn.rolls.map((roll) => {
        const interpretation = turn.rollInterpretations?.find((entry) => entry.rollId === roll.id);
        const actor = characters.find((character) => character.id === roll.actorId)?.name;
        const target = characters.find((character) => character.id === roll.targetId)?.name;
        return (
          <div className="dice-roll" key={roll.id}>
            <p>
              <strong>
                Roll {roll.slot + 1}: {roll.reason}
              </strong>
              {actor && ` · ${actor}`}
              {target && ` → ${target}`}
            </p>
            <p className="muted">Declared before rolling: {roll.declaration}</p>
            {roll.groups.map((group) => (
              <p key={group.label}>
                <strong>{group.label}</strong> · {group.faces.length}d{group.sides}:{' '}
                <span
                  className="dice-faces"
                  role="img"
                  aria-label={`faces ${group.faces.join(', ')}`}
                >
                  {group.faces.map((face, index) => (
                    <Die key={index} sides={group.sides} face={face} />
                  ))}
                </span>
              </p>
            ))}
            {roll.rerollOf && <p className="muted">Reroll: {roll.rerollOf.reason}</p>}
            {interpretation ? (
              <>
                <p>GM interpretation: {interpretation.explanation}</p>
                {interpretation.corrections?.map((correction, index) => (
                  <p key={index}>Correction: {correction.explanation}</p>
                ))}
              </>
            ) : (
              <p className="muted">
                The attempt ended before a validated interpretation. These faces remain saved.
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}
