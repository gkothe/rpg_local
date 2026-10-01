import type { Source } from './types.js';
export function sourceSections(source: Source) {
  const sections: {
    id: string;
    index: number;
    text: string;
    start: number;
    end: number;
    page: number | null;
    version: number;
  }[] = [];
  let start = 0;
  while (start < source.text.length) {
    let end = Math.min(start + 4000, source.text.length);
    if (end < source.text.length) {
      const paragraph = source.text.lastIndexOf('\n\n', end);
      if (paragraph > start + 1000) end = paragraph + 2;
      if (/^[\uDC00-\uDFFF]$/.test(source.text[end] ?? '')) end--;
    }
    const nextPage = source.text.indexOf('\n## Page ', start + 1);
    if (nextPage >= start && nextPage + 1 < end) end = nextPage + 1;
    const headings = [
      ...source.text
        .slice(0, Math.max(start + 1, source.text.indexOf('\n', start) + 1))
        .matchAll(/^## Page (\d+)/gm),
    ];
    const page = headings.length ? Number(headings.at(-1)![1]) : null;
    sections.push({
      id: `${source.id}:${source.version}:${sections.length}`,
      index: sections.length,
      text: source.text.slice(start, end),
      start,
      end,
      page,
      version: source.version,
    });
    start = end;
  }
  return sections;
}
