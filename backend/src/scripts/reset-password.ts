import { newPasswordSchema } from '@k12/contracts';
import { closePool, pool } from '../db/pool.js';
import { hashPassword } from '../modules/auth/password.js';

/**
 * Operator password reset, for when nobody can sign in at all.
 *
 * This replaces the conventional emailed reset link, which this system cannot
 * offer because it has no email provider. Run with `npm run db:reset-password`.
 *
 * Credentials come from the environment rather than from arguments so neither
 * lands in shell history, and the password is never printed.
 */

const EXIT_USAGE = 2;
const EXIT_FAILURE = 1;

function readRequired(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    console.error(`Missing ${name}.`);
    console.error(
      'Usage: RESET_ADMIN_EMAIL=... RESET_ADMIN_PASSWORD=... npm run db:reset-password',
    );
    process.exit(EXIT_USAGE);
  }
  return value;
}

async function main(): Promise<void> {
  const email = readRequired('RESET_ADMIN_EMAIL');
  const parsed = newPasswordSchema.safeParse(readRequired('RESET_ADMIN_PASSWORD'));

  if (!parsed.success) {
    console.error('The new password is not acceptable:');
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.message}`);
    }
    process.exit(EXIT_USAGE);
  }

  const passwordHash = await hashPassword(parsed.data);
  const client = await pool.connect();

  try {
    await client.query('begin');

    const { rows } = await client.query<{ id: string }>(
      `update admins
          set password_hash = $2
        where lower(email) = lower($1)
          and deleted_at is null
        returning id`,
      [email, passwordHash],
    );

    const admin = rows[0];
    if (admin === undefined) {
      await client.query('rollback');
      console.error(`No active admin account found for ${email}. Nothing was changed.`);
      process.exit(EXIT_FAILURE);
    }

    // Every existing session dies with the old password.
    const revoked = await client.query(
      `update refresh_tokens set revoked_at = now() where admin_id = $1 and revoked_at is null`,
      [admin.id],
    );

    await client.query('commit');

    console.log(`Password reset for ${email}.`);
    console.log(`Revoked ${revoked.rowCount ?? 0} active session(s).`);
    console.log('The new password was not printed. Sign in with RESET_ADMIN_PASSWORD.');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

try {
  await main();
} catch (error) {
  console.error('Reset failed:', error instanceof Error ? error.message : error);
  process.exitCode = EXIT_FAILURE;
} finally {
  await closePool();
}
