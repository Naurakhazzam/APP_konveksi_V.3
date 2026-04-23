import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema:  './src/db/schema.ts',
  out:     './supabase/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: [
      'postgresql://postgres:',
      process.env.SUPABASE_DB_PASSWORD,
      '@db.nhzwvxvpgubswtbyhygb.supabase.co:5432/postgres',
    ].join(''),
  },
});
