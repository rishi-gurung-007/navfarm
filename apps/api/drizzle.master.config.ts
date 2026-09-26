import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/core/database/master-schema.ts',
  out: './src/drizzle/master',
  dialect: 'mysql',
  dbCredentials: {
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '3306', 10),
    user: process.env.DATABASE_USERNAME || 'root',
    password: process.env.DATABASE_PASSWORD || '',
    database: process.env.DATABASE_NAME || 'nf_master',
    ...(process.env.DATABASE_SSL === 'true' ? { ssl: { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true } } : {}),
  },
});
