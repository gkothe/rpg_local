import { createApp } from './app.js';
import { Store } from './store.js';
import { createServer, type Server } from 'node:https';
import { readFile } from 'node:fs/promises';
import { privateIpv4 } from './security.js';
const port = Number(process.env.RPG_PORT ?? 4100);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('RPG_PORT must be1024..65535');
const lanHost = process.env.RPG_LAN_HOST;
const lan = !!lanHost;
if (lanHost && !privateIpv4(lanHost))
  throw new Error('RPG_LAN_HOST must be an explicit private IPv4 interface address');
const certificatePath = process.env.RPG_TLS_CERT_PATH;
const keyPath = process.env.RPG_TLS_KEY_PATH;
if (!!certificatePath !== !!keyPath)
  throw new Error('Configure both RPG_TLS_CERT_PATH and RPG_TLS_KEY_PATH');
const httpsPort = Number(process.env.RPG_HTTPS_PORT ?? 4443);
if (!Number.isInteger(httpsPort) || httpsPort < 1024 || httpsPort > 65535 || httpsPort === port)
  throw new Error('RPG_HTTPS_PORT must be 1024..65535 and differ from RPG_PORT');
const tls =
  certificatePath && keyPath
    ? { cert: await readFile(certificatePath), key: await readFile(keyPath) }
    : null;
let store: Store | null = null;
try {
  store = new Store();
  await store.recover();
} catch {
  console.log(
    'PostgreSQL is not ready. Diagnostics/frontend remain available; configure a dedicated RPG_DATABASE_URL and run migrations.'
  );
  if (store) {
    await store.close().catch(() => {});
    store = null;
  }
}
const hosts = [`127.0.0.1:${port}`, `localhost:${port}`, '127.0.0.1:5174', 'localhost:5174'];
const origins = hosts.map((h) => `http://${h}`);
if (lanHost) {
  hosts.push(`${lanHost}:${port}`);
  origins.push(`http://${lanHost}:${port}`);
}
const connectUrls = lanHost ? [`http://${lanHost}:${port}`] : [];
if (tls) {
  for (const host of ['127.0.0.1', 'localhost', ...(lanHost ? [lanHost] : [])]) {
    hosts.push(`${host}:${httpsPort}`);
    origins.push(`https://${host}:${httpsPort}`);
  }
  if (lanHost) connectUrls.unshift(`https://${lanHost}:${httpsPort}`);
}
const { app } = createApp({
  store,
  allowedHosts: hosts,
  allowedOrigins: origins,
  lan,
  connectUrls,
});
const server = app.listen(port, lanHost ?? '127.0.0.1', () =>
  console.log(`Local RPG: http://${lanHost ?? '127.0.0.1'}:${port}`)
);
// LAN mode also serves a loopback listener for desktop-only pairing controls.
const localServer = lanHost ? app.listen(port, '127.0.0.1') : null;
const secureServers: Server[] = [];
if (tls) {
  const secureServer = createServer(tls, app);
  secureServer.listen(httpsPort, lanHost ?? '127.0.0.1');
  secureServers.push(secureServer);
  if (lanHost) {
    const secureLocalServer = createServer(tls, app);
    secureLocalServer.listen(httpsPort, '127.0.0.1');
    secureServers.push(secureLocalServer);
  }
}
const recoveryTimer = setInterval(() => {
  void store?.recover().catch(() => {});
}, 15000);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    clearInterval(recoveryTimer);
    server.close();
    localServer?.close();
    for (const secureServer of secureServers) secureServer.close();
    void store?.close().finally(() => process.exit(0));
    if (!store) process.exit(0);
  });
