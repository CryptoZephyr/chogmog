import { databasePool } from './database.ts';
import { PostgresStore } from './postgresStore.ts';
import { authResponse, errorResponse } from './walletAuth.ts';
import { ownerResponse } from './ownershipRoute.ts';
import { publicationResponse } from './publicationRoute.ts';
import { resolvePreviewSource } from '../domain/documents.ts';
import { genesisReader } from '../chain/genesisOwnership.ts';

let backend: { origin: string; store: PostgresStore } | undefined;

export function backendConfiguration(env: NodeJS.ProcessEnv) {
  if (env.CHOGMOG_BACKEND_ENABLED !== 'true' || !env.CHOGMOG_DATABASE_URL || !env.APP_ORIGIN) throw new Error('Shared backend disabled');
  const url = new URL(env.APP_ORIGIN);
  if (url.protocol !== 'https:' || url.origin !== env.APP_ORIGIN || url.username || url.password) throw new Error('Exact HTTPS app origin required');
  return { origin: url.origin, databaseUrl: env.CHOGMOG_DATABASE_URL };
}

export async function deployedResponse(request: Request): Promise<Response> {
  try {
    const config = backendConfiguration(process.env);
    if (!backend) {
      const pool = databasePool(config.databaseUrl);
      try {
        const { rows } = await pool.query('select version from chogmog.schema_migrations order by version');
        if (rows.length !== 1 || rows[0].version !== '001_publication.sql') throw new Error('Database migration required');
      } catch (error) { await pool.end(); throw error; }
      backend = { origin: config.origin, store: new PostgresStore(pool) };
    }
    if (backend.origin !== config.origin) throw new Error('Backend restart required');
    const path = new URL(request.url).pathname;
    if (path === '/api/auth') return await authResponse(request, backend.store, backend.origin);
    if (path === '/api/owner') return await ownerResponse(request, backend.store, genesisReader, backend.origin);
    return await publicationResponse(request, backend.store, backend.store, genesisReader, resolvePreviewSource, backend.origin);
  } catch (error) { return errorResponse(error); }
}
