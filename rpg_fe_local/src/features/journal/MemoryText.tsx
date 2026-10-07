export function MemoryText({ text }: { text: string }) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length && lines.every((line) => /^[-*•]\s+\S/.test(line)))
    return (
      <ul className="prose">
        {lines.map((line, index) => (
          <li key={index}>{line.replace(/^[-*•]\s+/, '')}</li>
        ))}
      </ul>
    );
  return <p className="prose">{text}</p>;
}
