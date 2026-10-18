import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import type { Plugin, ViteDevServer } from 'vite';
import { sourceResponse } from './src/server/sourceCache.ts';

function previewSources(): Plugin {
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
  };
  return { name: 'pinned-genesis-previews', configureServer: configure, configurePreviewServer: configure };
}

export default defineConfig({
  plugins: [react(), previewSources()],
  server: { strictPort: true },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
