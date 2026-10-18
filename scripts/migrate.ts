import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { databasePool } from '../src/server/database.ts';

export async function migrate(pool: Pool) {
  const db = await pool.connect();
  try {
    await db.query('begin');
    await db.query("select pg_advisory_xact_lock(hashtextextended('chogmog-migrations', 0))");
    await db.query(`create schema if not exists chogmog;
      revoke all on schema chogmog from public;
      create table if not exists chogmog.schema_migrations (version text primary key, hash text not null);
      revoke all on chogmog.schema_migrations from public;
      alter table chogmog.schema_migrations enable row level security`);
    const directory = new URL('../migrations/', import.meta.url);
    for (const file of (await readdir(directory)).filter((f) => /^\d+_[a-z_]+\.sql$/.test(f)).sort()) {
      const sql = await readFile(new URL(file, directory), 'utf8');
      const hash = createHash('sha256').update(sql).digest('hex');
      const applied = await db.query('select hash from chogmog.schema_migrations where version = $1', [file]);
      if (applied.rows.length) {
        if (applied.rows[0].hash !== hash) throw new Error('Applied migration checksum mismatch');
      } else {
        await db.query(sql);
        await db.query('insert into chogmog.schema_migrations values ($1, $2)', [file, hash]);
      }
    }
    await db.query('commit');
  } catch (error) { await db.query('rollback'); throw error; }
  finally { db.release(); }
}

if (import.meta.main) {
  const connection = process.env.CHOGMOG_DATABASE_URL;
  if (!connection) { console.error('CHOGMOG_DATABASE_URL is required'); process.exitCode = 1; }
  else {
    let pool: Pool | undefined;
    try { pool = databasePool(connection); await migrate(pool); console.log('Chogmog migrations applied'); }
    catch { console.error('Migration failed. Check database configuration and migration state privately.'); process.exitCode = 1; }
    finally { await pool?.end(); }
  }
}
