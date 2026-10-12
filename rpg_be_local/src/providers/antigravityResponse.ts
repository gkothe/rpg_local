/** Repair only trailing structural commas; quoted strings and all other syntax stay intact. */
export function parseAntigravityResponse(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  const input = fenced ? fenced[1]! : trimmed;
  try {
    return JSON.parse(input);
  } catch (originalError) {
    let quoted = false;
    let escaped = false;
    let repaired = '';
    let changed = false;
    for (let i = 0; i < input.length; i++) {
      const character = input[i]!;
      if (quoted) {
        repaired += character;
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') quoted = false;
      } else {
        if (character === '"') quoted = true;
        if (character === ',') {
          let next = i + 1;
          while (next < input.length && /[\t\n\r ]/.test(input[next]!)) next++;
          let previous = i - 1;
          while (previous >= 0 && /[\t\n\r ]/.test(input[previous]!)) previous--;
          if (
            previous >= 0 &&
            !'[,{:'.includes(input[previous]!) &&
            (input[next] === '}' || input[next] === ']')
          ) {
            changed = true;
            continue;
          }
        }
        repaired += character;
      }
    }
    if (!changed) throw originalError;
    return JSON.parse(repaired);
  }
}
