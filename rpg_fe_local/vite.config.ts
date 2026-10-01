import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
const target = process.env.RPG_DEV_API_TARGET || 'http://127.0.0.1:4100';
const targetUrl = new URL(target);
if (
  !['http:', 'https:'].includes(targetUrl.protocol) ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(targetUrl.hostname) ||
  targetUrl.username ||
  targetUrl.password
)
  throw new Error('RPG_DEV_API_TARGET must be a local loopback backend URL.');
const cert = process.env.RPG_DEV_HTTPS_CERT,
  key = process.env.RPG_DEV_HTTPS_KEY;
if (!!cert !== !!key)
  throw new Error('Set both RPG_DEV_HTTPS_CERT and RPG_DEV_HTTPS_KEY for local development HTTPS.');
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    https: cert && key ? { cert: readFileSync(cert), key: readFileSync(key) } : undefined,
    proxy: { '/api': { target, secure: true } },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
