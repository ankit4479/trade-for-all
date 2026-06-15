/**
 * Postgres client + Drizzle instance (Phase 1).
 * Uses postgres-js. DATABASE_URL comes from .env (never the client bundle).
 */
import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Add it to .env (see .env.example).');
}

// Single shared connection pool for the app/loaders.
export const sql = postgres(connectionString, { max: 10 });
export const db = drizzle(sql, { schema });
export { schema };
