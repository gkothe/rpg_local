import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ReadAloud } from './ReadAloud';

export function NarratedText({
  text,
  readable,
  afterParagraph,
}: {
  text: string;
  readable: boolean;
  afterParagraph?: ReadonlyMap<number, ReactNode>;
}) {
  const [position, setPosition] = useState<number | null>(null);
  const highlighted = useRef<HTMLElement>(null);
  const sentences = useMemo(
    () => [...new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text)],
    [text]
  );
  const active =
    position === null
      ? -1
      : sentences.findIndex(
          (sentence) =>
            position >= sentence.index && position < sentence.index + sentence.segment.length
        );
  useEffect(() => {
    highlighted.current?.scrollIntoView?.({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'smooth',
    });
  }, [active]);
  const renderRange = (start: number, end: number) =>
    sentences.map((sentence, index) => {
      const from = Math.max(start, sentence.index);
      const to = Math.min(end, sentence.index + sentence.segment.length);
      if (from >= to) return null;
      return index === active ? (
        <mark className="spoken-sentence" ref={highlighted} key={sentence.index}>
          {text.slice(from, to)}
        </mark>
      ) : (
        <Fragment key={sentence.index}>{text.slice(from, to)}</Fragment>
      );
    });
  const paragraphs = [...text.matchAll(/\r?\n\s*\r?\n/g)];
  const ends = [...paragraphs.map((match) => match.index), text.length];
  return (
    <>
      {afterParagraph?.size ? (
        ends.map((end, index) => (
          <Fragment key={index}>
            <div className="prose narrative-paragraph">
              {renderRange(
                index === 0 ? 0 : paragraphs[index - 1]!.index + paragraphs[index - 1]![0].length,
                end
              )}
            </div>
            {afterParagraph.get(index + 1)}
          </Fragment>
        ))
      ) : (
        <div className="prose">{renderRange(0, text.length)}</div>
      )}
      {readable && <ReadAloud key={text} text={text} onPosition={setPosition} />}
    </>
  );
}
