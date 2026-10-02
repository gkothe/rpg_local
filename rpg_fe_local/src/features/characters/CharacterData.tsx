function label(key: string) {
  return key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
}
export default function CharacterData({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="muted">—</span>;
  if (Array.isArray(value)) {
    return value.length ? (
      <ul className="character-data-list">
        {value.map((item, index) => (
          <li key={index}>
            <CharacterData value={item} />
          </li>
        ))}
      </ul>
    ) : (
      <p className="muted">Nothing recorded.</p>
    );
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    return entries.length ? (
      <dl className="character-data">
        {entries.map(([key, item]) => (
          <div key={key} className={item && typeof item === 'object' ? 'nested' : ''}>
            <dt>{label(key)}</dt>
            <dd>
              <CharacterData value={item} />
            </dd>
          </div>
        ))}
      </dl>
    ) : (
      <p className="muted">Nothing recorded.</p>
    );
  }
  return <span className="character-value">{String(value)}</span>;
}
