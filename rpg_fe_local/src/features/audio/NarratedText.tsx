import { useEffect, useMemo, useRef, useState } from 'react';
import { ReadAloud } from './ReadAloud';

export function NarratedText({ text, readable }: { text: string; readable: boolean }) {
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
  return (
    <>
      <div className="prose">
        {sentences.map((sentence, index) =>
          index === active ? (
            <mark className="spoken-sentence" ref={highlighted} key={sentence.index}>
              {sentence.segment}
            </mark>
          ) : (
            sentence.segment
          )
        )}
      </div>
      {readable && <ReadAloud key={text} text={text} onPosition={setPosition} />}
    </>
  );
}
