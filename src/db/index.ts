// =============================================================================
// src/db/index.ts
// Inisialisasi Drizzle ORM dengan Supabase direct connection.
// HANYA dipakai di server (Server Actions, Route Handlers, Server Components).
// =============================================================================

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = [
  'postgresql://postgres:',
  process.env.SUPABASE_DB_PASSWORD,
  '@db.nhzwvxvpgubswtbyhygb.supabase.co:5432/postgres',
].join('');

// Satu koneksi shared di server (singleton pattern untuk avoid connection pool exhaustion)
const client = postgres(connectionString, {
  max: 10,          // maksimal 10 koneksi di pool
  idle_timeout: 20, // tutup koneksi idle setelah 20 detik
});

export const db = drizzle(client, { schema });

// Re-export schema untuk dipakai di Server Actions tanpa import ganda
export { schema };
