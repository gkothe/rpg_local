export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
  }
}
async function payload<T>(
  path: string,
  options: RequestInit = {}
): Promise<{ data: T; pagination?: { nextCursor: string | null } }> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  if (options.method && options.method !== 'GET') headers.set('X-RPG-Client', 'local-rpg');
  const response = await fetch(`/api${path}`, { ...options, headers });
  const text = await response.text();
  let value: unknown;
  try {
    value = text ? JSON.parse(text) : undefined;
  } catch {
    throw new ApiError('The server returned an unreadable response.', response.status);
  }
  if (!response.ok) {
    const error = value as { detail?: string; title?: string; code?: string };
    if (error?.code === 'pairing_required' && typeof window !== 'undefined')
      window.dispatchEvent(new Event('rpg-pairing-required'));
    throw new ApiError(
      error?.detail || error?.title || `Request failed (${response.status}).`,
      response.status,
      error?.code
    );
  }
  if (!value || typeof value !== 'object' || !('data' in value))
    throw new ApiError('The server returned an incomplete response.', response.status);
  return value as { data: T; pagination?: { nextCursor: string | null } };
}
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  return (await payload<T>(path, options)).data;
}
export async function requestCollection<T>(path: string): Promise<T[]> {
  const result: T[] = [];
  let cursor: string | null = null;
  const seen = new Set<string>();
  do {
    const url = new URL(path, 'http://localhost');
    url.searchParams.set('limit', '100');
    if (cursor !== null) url.searchParams.set('cursor', cursor);
    const page = await payload<T[]>(`${url.pathname}${url.search}`);
    if (!Array.isArray(page.data)) throw new ApiError('Expected a collection response.', 200);
    result.push(...page.data);
    cursor = page.pagination?.nextCursor ?? null;
    if (cursor !== null) {
      if (seen.has(cursor)) throw new ApiError('The server repeated a pagination cursor.', 200);
      seen.add(cursor);
    }
  } while (cursor !== null);
  return result;
}
export const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
});
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Please retry.';
