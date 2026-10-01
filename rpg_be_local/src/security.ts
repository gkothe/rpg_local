import type { RequestHandler, Request } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { Problem } from './errors.js';
export const loopback = (req: Request) =>
  ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');
export function privateIpv4(value: string): boolean {
  if (isIP(value) !== 4) return false;
  const [a, b] = value.split('.').map(Number);
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b! >= 16 && b! <= 31);
}
export function accessBoundary(allowedHosts: string[], allowedOrigins: string[]): RequestHandler {
  return (req, _res, next) => {
    try {
      const host = req.headers.host;
      if (!host || !allowedHosts.includes(host))
        throw new Problem(403, 'host_denied', 'Unapproved Host header');
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.includes(origin))
        throw new Problem(403, 'origin_denied', 'Unapproved browser origin');
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        if (req.get('X-RPG-Client') !== 'local-rpg')
          throw new Problem(
            403,
            'client_header',
            'Use the game frontend or an explicit local client with X-RPG-Client'
          );
        if (!origin && !loopback(req))
          throw new Problem(403, 'origin_required', 'LAN writes require a same-origin browser');
        if (
          req.method !== 'DELETE' &&
          !req.is('application/json') &&
          !req.is('multipart/form-data')
        )
          throw new Problem(415, 'content_type', 'Use JSON or an uploaded file');
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}
type Session = { token: string; expires: number };
export class LanAccess {
  private code: string | null = null;
  private expires = 0;
  private sessions: Session[] = [];
  private attempts = new Map<string, { count: number; until: number }>();
  constructor(readonly enabled: boolean) {}
  status(req: Request, connectUrls: string[]) {
    const cookie = req.headers.cookie
      ?.split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith('rpg-device='))
      ?.slice(11);
    const session = this.sessions.find((s) => s.token === cookie && s.expires > Date.now());
    return {
      enabled: this.enabled,
      desktop: loopback(req),
      paired: !!session,
      expiresAt: session ? new Date(session.expires).toISOString() : null,
      connectUrls,
      microphoneRequiresHttps: true,
    };
  }
  codeForDesktop(req: Request) {
    if (!loopback(req))
      throw new Problem(403, 'desktop_only', 'Device approvals are controlled on the desktop');
    this.code = randomBytes(4).toString('hex').toUpperCase();
    this.expires = Date.now() + 120000;
    return { code: this.code, expiresAt: new Date(this.expires).toISOString() };
  }
  pair(req: Request, code: string): string {
    if (!this.enabled) throw new Problem(403, 'lan_disabled', 'LAN mode is off');
    const ip = req.socket.remoteAddress ?? '';
    const a = this.attempts.get(ip);
    if (a && a.until > Date.now() && a.count >= 5)
      throw new Problem(429, 'pairing_limit', 'Too many pairing attempts; wait one minute');
    this.attempts.set(ip, {
      count: a && a.until > Date.now() ? a.count + 1 : 1,
      until: Date.now() + 60000,
    });
    const expected = Buffer.from(this.code ?? '');
    const provided = Buffer.from(code);
    if (
      !this.code ||
      this.expires < Date.now() ||
      provided.length !== expected.length ||
      !timingSafeEqual(expected, provided)
    )
      throw new Problem(403, 'pairing_code', 'Invalid or expired desktop pairing code');
    this.code = null;
    const token = randomBytes(32).toString('hex');
    this.sessions.push({ token, expires: Date.now() + 12 * 60 * 60 * 1000 });
    return token;
  }
  middleware(): RequestHandler {
    return (req, _res, next) => {
      if (
        !this.enabled ||
        loopback(req) ||
        req.path === '/lan/pair' ||
        req.path === '/lan/status' ||
        req.path === '/settings' ||
        req.path === '/health'
      ) {
        next();
        return;
      }
      const cookie = req.headers.cookie
        ?.split(';')
        .map((x) => x.trim())
        .find((x) => x.startsWith('rpg-device='))
        ?.slice(11);
      if (!cookie || !this.sessions.some((s) => s.token === cookie && s.expires > Date.now())) {
        next(
          new Problem(403, 'pairing_required', 'Approve this phone using a desktop connection code')
        );
        return;
      }
      next();
    };
  }
  revoke(req: Request) {
    if (!loopback(req)) throw new Problem(403, 'desktop_only', 'Revoke devices from the desktop');
    this.sessions = [];
  }
}
