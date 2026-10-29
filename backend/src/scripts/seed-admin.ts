import { provisionAdminSchema } from '@k12/contracts';
import { closePool, pool } from '../db/pool.js';
import { hashPassword } from '../modules/auth/password.js';

/**
 * Provisions the first admin account.
 *
 * Run with `npm run db:seed`. Credentials come from the environment rather than
 * from arguments, so they do not persist in shell history, and the password is
 * hashed before it reaches the database. Nothing here prints the password.
 *
 * Idempotent: re-running with the same address updates the existing account's
 * password and name rather than failing, which is what makes it safe to use
 * both for first setup and for rotating a demo credential.
 */

/** Exit codes, so a caller can distinguish a usage error from a failure. */
const EXIT_USAGE = 2;
const EXIT_FAILURE = 1;

function readRequired(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    console.error(`Missing ${name}. Set it in .env or the environment, then run again.`);
    process.exit(EXIT_USAGE);
  }
  return value;
}

async function main(): Promise<void> {
  const candidate = {
    email: readRequired('SEED_ADMIN_EMAIL'),
    password: readRequired('SEED_ADMIN_PASSWORD'),
    fullName: process.env.SEED_ADMIN_FULL_NAME ?? 'Administrator',
  };

  const parsed = provisionAdminSchema.safeParse(candidate);
  if (!parsed.success) {
    console.error('The seed credentials are not valid:');
    for (const issue of parsed.error.issues) {
      // Field names only. The values, one of which is the password, are never
      // echoed.
      console.error(`  ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
    process.exit(EXIT_USAGE);
  }

  const { email, password, fullName } = parsed.data;
  const passwordHash = await hashPassword(password);

  // `on conflict` targets the same expression the unique index is built on, so
  // an address differing only in case is recognised as the same account.
  const { rows } = await pool.query<{ id: string; created: boolean }>(
    `insert into admins (email, password_hash, full_name)
     values ($1, $2, $3)
     on conflict (lower(email)) where deleted_at is null
     do update set password_hash = excluded.password_hash,
                   full_name     = excluded.full_name
     returning id, (created_at = updated_at) as created`,
    [email, passwordHash, fullName],
  );

  const result = rows[0];
  if (result === undefined) {
    console.error('The account was neither created nor updated. No changes were made.');
    process.exit(EXIT_FAILURE);
  }

  console.log(
    result.created
      ? `Created admin ${email} (${result.id}).`
      : `Updated existing admin ${email} (${result.id}).`,
  );
  console.log('Sign in with the password from SEED_ADMIN_PASSWORD. It was not printed.');
}

try {
  await main();
} catch (error) {
  console.error('Seeding failed:', error instanceof Error ? error.message : error);
  process.exitCode = EXIT_FAILURE;
} finally {
  await closePool();
}
