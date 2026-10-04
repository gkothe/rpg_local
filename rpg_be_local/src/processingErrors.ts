import { Problem } from './errors.js';

/** Never include raw provider output, exception messages, paths or rejected values. */
export function cliFailure(diagnostics: string): Problem {
  if (/hit your limit|usage limit|rate limit|quota|resource.exhausted/i.test(diagnostics))
    return new Problem(
      503,
      'provider_quota',
      'CLI account quota or rate limit reached; wait for the provider reset before retrying.'
    );
  if (
    /log.?in|authentication|unauthenticated|authorization|not authenticated|sign.?in/i.test(
      diagnostics
    )
  )
    return new Problem(
      503,
      'provider_auth',
      'Local CLI requires login; authenticate in its own terminal.'
    );
  return new Problem(
    502,
    'provider_failure',
    'Local process failed; inspect its own diagnostics and account/model availability.'
  );
}
export function operationalProblem(error: unknown): Problem {
  if (error instanceof Problem) return error;
  const code = (error as { code?: string } | null)?.code;
  if (code === '23514')
    return new Problem(
      503,
      'database_constraint',
      'Database rejected a stored value; check application diagnostics and pending migrations.'
    );
  if (['42P01', '42703'].includes(code ?? ''))
    return new Problem(
      503,
      'database_setup',
      'Database migrations are missing; run setup-database.cmd and restart the application.'
    );
  if (['ECONNREFUSED', 'ECONNRESET', '57P01', '57P03', '08006'].includes(code ?? ''))
    return new Problem(
      503,
      'local_service',
      'Local service connection failed; check PostgreSQL and local runtime availability before retrying.'
    );
  if (['ENOSPC', 'EDQUOT', '53100'].includes(code ?? ''))
    return new Problem(
      503,
      'local_storage',
      'Local storage is full; free disk space before retrying.'
    );
  if (['EACCES', 'EPERM'].includes(code ?? ''))
    return new Problem(
      503,
      'local_permissions',
      'Local file access was denied; check application folder permissions.'
    );
  return new Problem(
    503,
    'local_service',
    'Local processing failed; inspect the application diagnostics.'
  );
}
/** Preserve machine-readable database causes without SQL, rejected values or raw messages. */
export function safeProcessingFailure(error: unknown): {
  code: string;
  database?: { sqlState: string; table?: string; column?: string; constraint?: string };
} {
  const result: ReturnType<typeof safeProcessingFailure> = { code: operationalProblem(error).code };
  const fields = error as Record<string, unknown> | null;
  if (typeof fields?.code !== 'string' || !/^[0-9A-Z]{5}$/.test(fields.code)) return result;
  result.database = { sqlState: fields.code };
  for (const key of ['table', 'column', 'constraint'] as const) {
    const value = fields[key];
    if (typeof value === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/.test(value))
      result.database[key] = value;
  }
  return result;
}
export function reportProcessingFailure(stage: string, error: unknown, turnId?: string): void {
  console.error(
    JSON.stringify({
      event: 'processing_failure',
      stage,
      ...safeProcessingFailure(error),
      ...(turnId ? { turnId } : {}),
    })
  );
}
/** Cleanup must run, but never replace a primary generation/cancellation error. */
export async function finishProcessingCleanup(
  cleanup: () => Promise<void>,
  failed: boolean
): Promise<void> {
  try {
    await cleanup();
  } catch (error) {
    reportProcessingFailure('provider_cleanup', error);
    if (!failed)
      throw new Problem(
        503,
        'provider_cleanup',
        'CLI temporary files could not be cleaned; check local permissions and file locks.'
      );
  }
}
