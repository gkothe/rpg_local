import { Problem } from '../errors.js';

export type ApiFetch = typeof fetch;
/** Fixed official endpoints only: no user-supplied hosts, so credentials cannot be redirected. */
export const API_HOSTS = ['generativelanguage.googleapis.com', 'openrouter.ai'] as const;
const HTTP_STATUS = { Unauthorized: 401, Forbidden: 403, NotFound: 404, RateLimit: 429 } as const;

/** Provider message classification only; raw bodies and headers are never surfaced. */
function statusProblem(status: number, provider: string): Problem {
  if (status === HTTP_STATUS.Unauthorized || status === HTTP_STATUS.Forbidden)
    return new Problem(502, 'provider_auth', `${provider} rejected the configured API key`);
  if (status === HTTP_STATUS.RateLimit || status === 402)
    return new Problem(502, 'provider_quota', `${provider} quota or rate limit reached`);
  if (status === HTTP_STATUS.NotFound)
    return new Problem(502, 'model_unavailable', `${provider} does not offer the selected model`);
  if (status === 400 || status === 413 || status === 422)
    return new Problem(
      502,
      'provider_request',
      `${provider} rejected the request (invalid input or context too large)`
    );
  return new Problem(502, 'provider_failure', `${provider} failed with HTTP ${status}`);
}

export async function postJson(request: {
  provider: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  signal?: AbortSignal;
  fetchImpl?: ApiFetch;
}): Promise<unknown> {
  const url = new URL(request.url);
  if (url.protocol !== 'https:' || !(API_HOSTS as readonly string[]).includes(url.hostname))
    throw new Problem(500, 'provider_setup', 'API requests are limited to the official endpoints');
  if (request.signal?.aborted) throw new Problem(409, 'cancelled', 'Request cancelled');
  let response: Response;
  try {
    response = await (request.fetchImpl ?? fetch)(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...request.headers },
      body: JSON.stringify(request.body),
      redirect: 'error',
      signal: request.signal,
    });
  } catch {
    if (request.signal?.aborted) throw new Problem(409, 'cancelled', 'Request cancelled');
    throw new Problem(502, 'provider_network', `${request.provider} could not be reached`);
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    if (request.signal?.aborted) throw new Problem(409, 'cancelled', 'Request cancelled');
    throw new Problem(502, 'provider_network', `${request.provider} response was interrupted`);
  }
  if (!response.ok) throw statusProblem(response.status, request.provider);
  try {
    return JSON.parse(text);
  } catch {
    throw new Problem(502, 'invalid_response', `${request.provider} returned invalid JSON`);
  }
}
