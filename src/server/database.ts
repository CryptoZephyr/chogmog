import { Pool } from 'pg';

export function databasePool(connectionString: string, ci = false) {
  const url = new URL(connectionString);
  const local = ci && process.env.CI === 'true' && ['localhost', '127.0.0.1'].includes(url.hostname);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.username || !url.password ||
      (!local && (!/\.(supabase\.co|pooler\.supabase\.com)$/.test(url.hostname) || url.searchParams.get('sslmode') !== 'verify-full'))) {
    throw new Error('Dedicated TLS-verified database configuration required');
  }
  const pool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000, statement_timeout: 5_000, query_timeout: 7_000 });
  pool.on('error', () => {});
  return pool;
}
