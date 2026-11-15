import 'dotenv/config';
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';
import { customers, memberships, tenants, users } from './schema/index.js';

const databaseUrl =
  process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is required to run the seed. Copy .env.example to .env.',
  );
}

const tenantSlug = process.env.SEED_TENANT_SLUG ?? 'demo';
const ownerEmail = (
  process.env.SEED_OWNER_EMAIL ?? 'owner@opria.app'
).toLowerCase();
const ownerPassword = process.env.SEED_OWNER_PASSWORD ?? 'opria-demo-2026';
const customerEmail = (
  process.env.SEED_CUSTOMER_EMAIL ?? 'cliente@opria.app'
).toLowerCase();
const customerPassword =
  process.env.SEED_CUSTOMER_PASSWORD ?? 'opria-cliente-2026';

const client = postgres(databaseUrl, { max: 1, prepare: false });
const db = drizzle(client, { schema });

async function seed(): Promise<void> {
  await db.transaction(async (tx) => {
    const existingTenant = await tx.query.tenants.findFirst({
      where: eq(tenants.slug, tenantSlug),
    });

    const tenant =
      existingTenant ??
      (
        await tx
          .insert(tenants)
          .values({
            name: 'Opria Demo',
            slug: tenantSlug,
            timezone: 'America/Argentina/Buenos_Aires',
            city: 'Buenos Aires',
          })
          .returning()
      )[0];

    if (!tenant.city) {
      await tx
        .update(tenants)
        .set({ city: 'Buenos Aires' })
        .where(eq(tenants.id, tenant.id));
    }

    const existingUser = await tx.query.users.findFirst({
      where: eq(users.email, ownerEmail),
    });

    const user =
      existingUser ??
      (
        await tx
          .insert(users)
          .values({
            email: ownerEmail,
            name: 'Demo Owner',
            passwordHash: await argon2.hash(ownerPassword),
            emailVerifiedAt: new Date(),
          })
          .returning()
      )[0];

    await tx
      .insert(memberships)
      .values({
        tenantId: tenant.id,
        userId: user.id,
        role: 'owner',
      })
      .onConflictDoNothing({
        target: [memberships.tenantId, memberships.userId],
      });

    const existingCustomer = await tx.query.customers.findFirst({
      where: eq(customers.email, customerEmail),
    });

    if (!existingCustomer) {
      await tx.insert(customers).values({
        email: customerEmail,
        name: 'Cliente Demo',
        phone: '+54 11 5555 0000',
        passwordHash: await argon2.hash(customerPassword),
        emailVerifiedAt: new Date(),
      });
    }
  });
}

try {
  await seed();

  console.log('Seed complete');
  console.log(`  tenant:   ${tenantSlug}`);
  console.log(`  email:    ${ownerEmail}`);
  console.log(`  password: ${ownerPassword}`);
  console.log(`  customer: ${customerEmail}`);
  console.log(`  customer password: ${customerPassword}`);
} catch (error) {
  console.error('Seed failed:', error);
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
