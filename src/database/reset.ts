import 'dotenv/config';
import postgres from 'postgres';

/**
 * Destructive reset for local/staging databases. It only truncates tables in
 * the `app` schema; Drizzle bookkeeping, extensions and roles are untouched.
 *
 *   npm run db:reset -- --yes
 */
const databaseUrl = process.env.DATABASE_URL_DIRECT;

if (!process.argv.includes('--yes')) {
  console.error(
    'Uso: npm run db:reset -- --yes\n' +
      'Borra TODAS las filas del schema "app" de la base indicada en DATABASE_URL_DIRECT.',
  );
  process.exitCode = 1;
} else if (process.env.NODE_ENV === 'production') {
  console.error('El reset está prohibido con NODE_ENV=production.');
  process.exitCode = 1;
} else if (!databaseUrl) {
  console.error(
    'DATABASE_URL_DIRECT es obligatoria para el reset (nunca uses el pooler).',
  );
  process.exitCode = 1;
} else {
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  const target = new URL(databaseUrl).host;

  try {
    const tables = await client<{ table_name: string }[]>`
      select table_name
      from information_schema.tables
      where table_schema = 'app' and table_type = 'BASE TABLE'
      order by table_name
    `;

    if (tables.length === 0) {
      throw new Error(
        'No hay tablas en el schema "app". Corré las migraciones antes de resetear.',
      );
    }

    const identifiers = tables
      .map((row) => `"app"."${row.table_name.replaceAll('"', '""')}"`)
      .join(', ');

    console.log(`Reseteando ${tables.length} tablas de "app" en ${target}…`);
    await client.unsafe(
      `TRUNCATE TABLE ${identifiers} RESTART IDENTITY CASCADE`,
    );
    console.log('Listo.');
  } catch (error) {
    console.error('No se pudo completar el reset:', error);
    process.exitCode = 1;
  } finally {
    await client.end({ timeout: 5 });
  }
}
