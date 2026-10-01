import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { LanAccess } from '../src/security.js';
const req = (address: string, path = '/campaigns', cookie?: string) =>
  ({ socket: { remoteAddress: address }, path, headers: { cookie } }) as unknown as Request;
function allowed(lan: LanAccess, request: Request) {
  let error: unknown;
  lan.middleware()(request, {} as Response, (e) => {
    error = e;
  });
  return !error;
}
test('opt-in LAN read/write access requires expiring single-use desktop approval and revocation', () => {
  const lan = new LanAccess(true);
  const desktop = req('127.0.0.1');
  const phone = req('192.168.1.50');
  assert.equal(allowed(lan, phone), false);
  assert.throws(() => lan.codeForDesktop(phone), /desktop/);
  const approval = lan.codeForDesktop(desktop);
  const token = lan.pair(phone, approval.code);
  assert.equal(allowed(lan, req('192.168.1.50', '/campaigns', `rpg-device=${token}`)), true);
  assert.throws(() => lan.pair(phone, approval.code), /expired/);
  lan.revoke(desktop);
  assert.equal(allowed(lan, req('192.168.1.50', '/campaigns', `rpg-device=${token}`)), false);
  assert.equal(allowed(lan, desktop), true);
});
test('pairing is disabled by default and repeated invalid attempts are bounded', () => {
  assert.throws(() => new LanAccess(false).pair(req('192.168.1.50'), 'bad'), /off/);
  const lan = new LanAccess(true);
  for (let i = 0; i < 5; i++) assert.throws(() => lan.pair(req('192.168.1.50'), 'bad'), /Invalid/);
  assert.throws(() => lan.pair(req('192.168.1.50'), 'bad'), /Too many/);
});
