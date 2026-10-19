import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import type { Plugin, ViteDevServer } from 'vite';
import { sourceResponse } from './src/server/sourceCache.ts';
import { authResponse, errorResponse, jsonResponse, MemoryAuthStore } from './src/server/walletAuth.ts';
import { genesisReader } from './src/chain/genesisOwnership.ts';
import { ownerResponse } from './src/server/ownershipRoute.ts';
import { holderSourceResponse } from './src/server/holderSource.ts';

function previewSources(): Plugin {
  const store = new MemoryAuthStore();
  const configure = (server: Pick<ViteDevServer, 'middlewares'>) => {
    server.middlewares.use('/api/source', (req, res, next) => {
      if (req.url?.split('?')[0] !== '/' && !req.url?.startsWith('?')) {
        res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'Unknown source route' }));
        return;
      }
      void sourceResponse(new Request(`http://localhost/api/source${req.url?.replace(/^\//, '') ?? ''}`, { method: req.method }))
        .then(async (response) => {
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(Buffer.from(await response.arrayBuffer()));
        }).catch(next);
    });
    for (const path of ['/api/auth', '/api/owner', '/api/holder-source', '/api/publish', '/api/versions', '/api/discover']) server.middlewares.use(path, (req, res) => {
      const host = req.headers.host;
      let response: Promise<Response>;
      try {
        const origin = new URL(`http://${host}`);
        if (!['localhost', '127.0.0.1'].includes(origin.hostname)) throw new Error('Local development only');
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        const url = `${origin.origin}${path}${req.url?.replace(/^\//, '') ?? ''}`;
        const request = new Request(url, { method: req.method, headers,
          ...(req.method === 'POST' ? { body: req as unknown as ReadableStream<Uint8Array>, duplex: 'half' } : {}) } as RequestInit & { duplex?: 'half' });
        response = path === '/api/auth' ? authResponse(request, store, origin.origin) : path === '/api/owner' ? ownerResponse(request, store, genesisReader, origin.origin)
          : path === '/api/holder-source' ? holderSourceResponse(request, store, genesisReader, origin.origin)
          : Promise.resolve(jsonResponse({ error: 'Publication requires the shared backend' }, 503));
      } catch { response = Promise.resolve(jsonResponse({ error: 'Local auth unavailable' }, 503)); }
      void response.then(async (reply) => { res.writeHead(reply.status, Object.fromEntries(reply.headers)); res.end(Buffer.from(await reply.arrayBuffer())); })
        .catch((error: unknown) => { const reply = errorResponse(error); res.writeHead(reply.status, Object.fromEntries(reply.headers)); res.end(Buffer.from('')); });
    });
  };
  return { name: 'pinned-genesis-previews', configureServer: configure, configurePreviewServer: configure };
}

export default defineConfig({
  plugins: [react(), previewSources()],
  server: { strictPort: true },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
