import { expect, test } from 'vitest';
import { createServer } from 'vite';
import api from '../api/source';

test('real Vite HTTP middleware serves cache bytes and rejects open-proxy requests', async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'silent' });
  try {
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('No HTTP test address');
    const origin = `http://127.0.0.1:${address.port}`;
    const url = `${origin}/api/source?kind=artwork&id=25`;
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    const cached = await api.fetch(new Request(url));
    expect(await response.arrayBuffer()).toEqual(await cached.arrayBuffer());
    expect((await fetch(`${origin}/api/source?url=https://localhost`)).status).toBe(400);
    expect((await fetch(`${origin}/api/source/extra?kind=artwork&id=25`)).status).toBe(404);
  } finally { await server.close(); }
});
