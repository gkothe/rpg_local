export function parseObject(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('The sheet must be a JSON object.');
  return value as Record<string, unknown>;
}
