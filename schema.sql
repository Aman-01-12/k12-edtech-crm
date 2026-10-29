-- =============================================================================
-- K12 Hunar EdTech CRM and Inquiry System - complete database schema
--
-- Target: PostgreSQL 13 or newer (Supabase runs 15+).
-- Apply with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f schema.sql
--
-- This script is the single authoritative definition of the schema and is
-- idempotent: running it a second time against the same database is a no-op
-- rather than an error.
--
-- Two principles shape everything below.
--
--   1. The database is the last line of defence, not a dumb store. Every rule
--      the application enforces is also a constraint here, so an invalid row
--      cannot exist even if it is inserted by a direct connection or by a
--      future bug in the API.
--
--   2. Credentials are never stored in a reversible form. Passwords are bcrypt
--      hashes and refresh tokens are SHA-256 digests, both enforced by CHECK
--      constraints so a plaintext value is rejected by the column itself.
--
-- No seed data, no credentials and no secrets appear in this file. Provision the
-- first admin with `npm run db:seed`, which reads ADMIN_EMAIL and ADMIN_PASSWORD
-- from the environment.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------

-- Extensions live in their own schema, never in `public`. An extension in
-- `public` puts its functions on the default search path, where they can shadow
-- or be shadowed by application objects. Supabase's own database linter flags
-- `extension_in_public` for exactly this reason.
CREATE SCHEMA IF NOT EXISTS extensions;

-- Trigram indexing, which is what lets the dashboard's `ILIKE '%term%'` name and
-- phone search use an index instead of scanning the table. Postgres cannot use a
-- standard btree index for a leading-wildcard pattern.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- Resolve `gin_trgm_ops` below whether pg_trgm ended up in `extensions` (a fresh
-- database) or was already present in `public` (an existing one), so this script
-- applies to both without a conditional.
SET search_path = public, extensions;

-- `gen_random_uuid()` is core since PostgreSQL 13, so pgcrypto is deliberately
-- not required here.


-- -----------------------------------------------------------------------------
-- Shared trigger function
-- -----------------------------------------------------------------------------

-- Maintains `updated_at` in the database rather than in application code, so the
-- timestamp is correct no matter which client performed the update.
--
-- `SET search_path = ''` pins resolution at definition time. Without it, a role
-- able to create an object in an earlier schema on the caller's search path
-- could shadow a function this body calls and have it run with the trigger's
-- privileges. Every reference is therefore schema-qualified.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = pg_catalog.now();
  RETURN NEW;
END;
$$;


-- -----------------------------------------------------------------------------
-- admins
--
-- Staff accounts that can sign in to the dashboard. There is no public sign-up
-- and no self-service registration: accounts are provisioned deliberately.
--
-- There is no role column on purpose. The system has exactly one kind of
-- principal, so a role column would be an unused field, and authorization is
-- "is a live admin" asserted from the verified token claim. Adding a second role
-- later is a migration, which is the right amount of friction for a change that
-- alters the access model.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS admins (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  email         TEXT NOT NULL
                CONSTRAINT admins_email_length CHECK (char_length(email) BETWEEN 3 AND 254)
                CONSTRAINT admins_email_shape CHECK (email LIKE '%_@_%.__%'),

  -- A bcrypt modular-crypt digest, never a password. The pattern pins the
  -- `$2a$`, `$2b$` or `$2y$` prefix and the two-digit cost, so storing a
  -- plaintext password here fails at the database level.
  password_hash TEXT NOT NULL
                CONSTRAINT admins_password_hash_is_bcrypt
                CHECK (password_hash ~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$'),

  full_name     TEXT NOT NULL
                CONSTRAINT admins_full_name_length CHECK (char_length(full_name) BETWEEN 2 AND 120),

  -- Present from the first schema even though verification is not enforced yet,
  -- so switching it on later is a code change rather than a migration.
  email_verified_at TIMESTAMPTZ,

  last_login_at TIMESTAMPTZ,

  -- Access tokens issued at or before this instant are refused, which is what
  -- makes a password change or reset end sessions *now* rather than when the
  -- 15-minute JWT happens to expire. Revoking refresh tokens alone only stops
  -- a session being renewed; it leaves the current access token working.
  sessions_invalidated_at TIMESTAMPTZ,

  -- Soft delete. Accounts are never hard-deleted, because the security event log
  -- and the inquiry status trail reference them.
  deleted_at    TIMESTAMPTZ,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Uniqueness on the lowercased address, scoped to live accounts. Case-sensitive
-- uniqueness would allow `Admin@k12.com` and `admin@k12.com` to coexist and then
-- make sign-in depend on exactly how the address was typed.
CREATE UNIQUE INDEX IF NOT EXISTS admins_email_lower_key
  ON admins (LOWER(email))
  WHERE deleted_at IS NULL;

-- `CREATE TABLE IF NOT EXISTS` above does nothing on a database that already
-- has this table, so a column added after it first existed needs this to reach
-- an existing deployment.
ALTER TABLE admins ADD COLUMN IF NOT EXISTS sessions_invalidated_at TIMESTAMPTZ;

DROP TRIGGER IF EXISTS admins_set_updated_at ON admins;
CREATE TRIGGER admins_set_updated_at
  BEFORE UPDATE ON admins
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- inquiries
--
-- The table both surfaces share: written by anonymous visitors through the
-- public form, read and triaged by authenticated admins.
--
-- The three enum-like columns are TEXT with CHECK constraints rather than native
-- enum types. Adding a permitted value then requires an explicit migration
-- instead of an `ALTER TYPE`, and the driver needs no type-parsing special case.
-- The permitted values are the exact strings in packages/contracts/src/enums.ts.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS inquiries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_type   TEXT NOT NULL
              CONSTRAINT inquiries_user_type_valid
              CHECK (user_type IN ('parent', 'student', 'school')),

  category    TEXT NOT NULL
              CONSTRAINT inquiries_category_valid
              CHECK (category IN ('scholarship', 'concert', 'admission', 'general_query')),

  status      TEXT NOT NULL DEFAULT 'new'
              CONSTRAINT inquiries_status_valid
              CHECK (status IN ('new', 'in_progress', 'resolved', 'closed')),

  full_name   TEXT NOT NULL
              CONSTRAINT inquiries_full_name_length
              CHECK (char_length(full_name) BETWEEN 2 AND 120),

  email       TEXT NOT NULL
              CONSTRAINT inquiries_email_length CHECK (char_length(email) BETWEEN 3 AND 254)
              CONSTRAINT inquiries_email_shape CHECK (email LIKE '%_@_%.__%'),

  -- E.164 for India, enforced here and not only in the validator. The admin
  -- phone search is a substring match, so it is only reliable if every stored
  -- number has exactly one possible representation.
  phone       TEXT NOT NULL
              CONSTRAINT inquiries_phone_is_e164_india
              CHECK (phone ~ '^\+91[6-9][0-9]{9}$'),

  message     TEXT NOT NULL
              CONSTRAINT inquiries_message_length
              CHECK (char_length(message) BETWEEN 10 AND 2000),

  -- Client-supplied key that makes a retried submission idempotent. The partial
  -- unique index below is the actual exactly-once guarantee; see
  -- docs/adr/0005-rate-limiting-and-idempotency.md.
  idempotency_key UUID,

  -- Who last moved this inquiry along, and when. SET NULL rather than CASCADE
  -- because the record of the change must outlive the account that made it.
  status_updated_at TIMESTAMPTZ,
  status_updated_by UUID REFERENCES admins (id) ON DELETE SET NULL,

  -- Owner, so a team can divide the queue. SET NULL for the same reason: an
  -- enquiry outlives whichever account happened to own it.
  assigned_to_admin_id UUID REFERENCES admins (id) ON DELETE SET NULL,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A status change must always record when it happened, so the audit trail
  -- cannot be half-written.
  CONSTRAINT inquiries_status_change_is_complete
  CHECK ((status_updated_at IS NULL) = (status_updated_by IS NULL))
);

-- Added after this table first shipped, so it needs an explicit ALTER to reach
-- a database that already has it; CREATE TABLE IF NOT EXISTS is a no-op there.
ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS assigned_to_admin_id UUID REFERENCES admins (id) ON DELETE SET NULL;

-- "My queue", the one view a staff member returns to all day. Partial: an
-- unassigned enquiry is found through the default listing, not through this.
CREATE INDEX IF NOT EXISTS inquiries_assigned_created_at_idx
  ON inquiries (assigned_to_admin_id, created_at DESC, id DESC)
  WHERE assigned_to_admin_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- inquiry_notes
--
-- Internal staff commentary on an enquiry: the "what happened when I rang them"
-- that every CRM has and that the enquiry's own columns cannot hold.
--
-- `author_name` is a snapshot rather than a join, so a note still says who
-- wrote it after that account is deactivated and `admin_id` goes NULL.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS inquiry_notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  inquiry_id UUID NOT NULL REFERENCES inquiries (id) ON DELETE CASCADE,

  admin_id   UUID REFERENCES admins (id) ON DELETE SET NULL,
  author_name TEXT NOT NULL
              CONSTRAINT inquiry_notes_author_name_length
              CHECK (char_length(author_name) BETWEEN 1 AND 120),

  body       TEXT NOT NULL
             CONSTRAINT inquiry_notes_body_length
             CHECK (char_length(body) BETWEEN 1 AND 2000),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The only query: this enquiry's notes, newest first.
CREATE INDEX IF NOT EXISTS inquiry_notes_inquiry_created_at_idx
  ON inquiry_notes (inquiry_id, created_at DESC);

DROP TRIGGER IF EXISTS inquiries_set_updated_at ON inquiries;
CREATE TRIGGER inquiries_set_updated_at
  BEFORE UPDATE ON inquiries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Exactly-once submission. Partial, so the overwhelming majority of rows (those
-- submitted without a key) cost nothing and are not forced to collide on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS inquiries_idempotency_key_key
  ON inquiries (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Default dashboard ordering and the keyset pagination predicate
-- `(created_at, id) < ($1, $2)`. `id` is in the key so that two inquiries
-- sharing a timestamp cannot cause a row to be skipped or repeated across pages.
CREATE INDEX IF NOT EXISTS inquiries_created_at_id_idx
  ON inquiries (created_at DESC, id DESC);

-- Name and phone search. Trigram GIN is what makes a leading-wildcard ILIKE
-- indexable at all; a btree cannot serve one.
--
-- Measured on 200,000 rows, searching for one specific person, which is the
-- case the dashboard search exists for:
--   with this index:  Bitmap Index Scan,    1.4 ms
--   without it:       Parallel Seq Scan,   18.1 ms
--
-- At 20,000 rows the planner often prefers to walk the ordering index and
-- filter, and it is right to: a scan of a small table is cheap. The index earns
-- its place as the table grows, which is the point of putting it in now.
--
-- For a term matching a large fraction of the table the planner also prefers
-- the ordering index, which is again the cheaper plan. Patterns under three
-- characters are not selective enough for a trigram index to help, which is why
-- the API requires at least two and accepts that a two-character term may scan.
CREATE INDEX IF NOT EXISTS inquiries_full_name_trgm_idx
  ON inquiries USING GIN (full_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS inquiries_phone_trgm_idx
  ON inquiries USING GIN (phone gin_trgm_ops);

-- Deliberately absent, each for a measured reason rather than a guess.
--
--   * (category, created_at DESC, id DESC) and the user_type equivalent. These
--     existed and were removed. With the ordering index present the planner
--     never chose either one, and dropping the ordering index showed the
--     composite was actually dearer for a filtered page (cost 10.37 against
--     8.60), because it is twice the size while the filter only removes three
--     quarters of the rows and LIMIT 20 is satisfied almost immediately.
--     pg_stat_user_indexes recorded zero scans of the user_type index across
--     the whole exercise. They cost 3240 kB plus write amplification on the
--     public submission path, which is the write-heavy one, and bought nothing.
--     A highly selective filter would change this; four categories and three
--     user types is not that.
--
--   * status. Not a filter this API exposes, and 'new' will hold most rows.


-- -----------------------------------------------------------------------------
-- refresh_tokens
--
-- Server-side session state for the two-token auth model. Access tokens are
-- stateless JWTs; refresh tokens are opaque random values recorded here so that
-- a session can actually be revoked.
--
-- Adapted from the reference design in docs/reference/, keeping its structure:
-- digest-only storage, a family id per sign-in, a predecessor chain, and
-- revocation by timestamp rather than by deleting the row.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  admin_id      UUID NOT NULL REFERENCES admins (id) ON DELETE CASCADE,

  -- SHA-256 of the raw 32-byte token. A plain digest rather than bcrypt is
  -- correct here precisely because the input is 32 bytes of CSPRNG output:
  -- there is no low-entropy guess space that a slow hash would protect.
  -- The length CHECK rejects anything that is not a 32-byte digest, so the raw
  -- token cannot be stored by mistake.
  token_hash    BYTEA NOT NULL UNIQUE
                CONSTRAINT refresh_tokens_hash_is_sha256
                CHECK (octet_length(token_hash) = 32),

  -- Every rotation of one sign-in shares this. Presenting an already-revoked
  -- token means the family is compromised and all of its siblings are revoked.
  family_id     UUID NOT NULL,

  -- The token this one replaced. Walking the chain reconstructs the full
  -- rotation history of a session.
  predecessor_id UUID REFERENCES refresh_tokens (id) ON DELETE SET NULL,

  -- Soft device context, for recognising an anomalous rotation. Never used as a
  -- security control, only as evidence.
  user_agent    TEXT CONSTRAINT refresh_tokens_user_agent_length
                CHECK (user_agent IS NULL OR char_length(user_agent) <= 400),
  ip_address    INET,

  issued_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,

  -- NULL means active. A timestamp means revoked; the row is kept for the trail.
  revoked_at    TIMESTAMPTZ,

  CONSTRAINT refresh_tokens_expires_after_issue CHECK (expires_at > issued_at)
);

-- Sign-out and "revoke every session for this admin". Partial, because revoked
-- rows are never the target of this lookup.
CREATE INDEX IF NOT EXISTS refresh_tokens_admin_active_idx
  ON refresh_tokens (admin_id)
  WHERE revoked_at IS NULL;

-- Family-wide revocation on theft detection. Not partial: this lookup must find
-- the already-revoked siblings too, which is the whole point.
CREATE INDEX IF NOT EXISTS refresh_tokens_family_idx
  ON refresh_tokens (family_id);

-- Expiry sweeping.
CREATE INDEX IF NOT EXISTS refresh_tokens_expires_at_idx
  ON refresh_tokens (expires_at)
  WHERE revoked_at IS NULL;

-- There is deliberately no partial index on (token_hash) WHERE revoked_at IS
-- NULL. The UNIQUE constraint above already creates a btree on token_hash that
-- serves the rotation lookup, and the rotation path must read revoked rows
-- anyway to detect reuse, so a partial index would be both redundant and wrong
-- for the query that matters.


-- -----------------------------------------------------------------------------
-- password_reset_tokens
--
-- The self-service "forgot password" flow (R19, ADR 0013). Same shape as
-- refresh_tokens and for the same reason: a SHA-256 digest of a 32-byte random
-- token, never the token itself, so a database leak alone cannot be used to
-- reset anyone's password.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- CASCADE, unlike refresh_tokens' SET NULL: a reset token has no meaning once
  -- its admin is gone, where a refresh-token audit trail does.
  admin_id   UUID NOT NULL REFERENCES admins (id) ON DELETE CASCADE,

  token_hash BYTEA NOT NULL UNIQUE
             CONSTRAINT password_reset_tokens_hash_is_sha256
             CHECK (octet_length(token_hash) = 32),

  expires_at TIMESTAMPTZ NOT NULL,

  -- NULL means unredeemed. A timestamp means used once already, which the
  -- redemption query checks for; the row is kept rather than deleted so the
  -- audit trail survives.
  used_at    TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT password_reset_tokens_expires_after_create CHECK (expires_at > created_at)
);

-- The redemption lookup and "does this admin already have a live token" check.
CREATE INDEX IF NOT EXISTS password_reset_tokens_admin_active_idx
  ON password_reset_tokens (admin_id)
  WHERE used_at IS NULL;


-- -----------------------------------------------------------------------------
-- security_events
--
-- Append-only record of security-relevant actions. No `updated_at` and no
-- trigger: nothing in this table is ever modified. UPDATE and DELETE are
-- revoked below so the application cannot rewrite its own history.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS security_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Adding a value here is a deliberate schema change, which is the point: the
  -- set of things worth auditing should not drift silently. The permitted
  -- values are declared once, below, rather than here, because an inline CHECK
  -- only applies on first creation and this constraint has already needed to
  -- grow since.
  event_type  TEXT NOT NULL,

  -- SET NULL so an event outlives the account it refers to.
  admin_id    UUID REFERENCES admins (id) ON DELETE SET NULL,

  -- The address someone tried to sign in with. Recorded on failure, where there
  -- may be no matching admin row to point at.
  email_attempted TEXT CONSTRAINT security_events_email_attempted_length
                  CHECK (email_attempted IS NULL OR char_length(email_attempted) <= 254),

  ip_address  INET,
  user_agent  TEXT CONSTRAINT security_events_user_agent_length
              CHECK (user_agent IS NULL OR char_length(user_agent) <= 400),

  -- Event-specific context. Never carries an inquiry's personal data; a row is
  -- referenced by its id.
  detail      JSONB NOT NULL DEFAULT '{}'::JSONB,

  -- Correlates the event with the API response and the application log line.
  request_id  UUID,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- `CREATE TABLE IF NOT EXISTS` above is a no-op on a database that already has
-- this table, so a value added to the CHECK after the table first existed
-- would never reach it without this: drop and re-add the constraint
-- unconditionally, converging to the current definition either way.
ALTER TABLE security_events DROP CONSTRAINT IF EXISTS security_events_type_valid;
ALTER TABLE security_events ADD CONSTRAINT security_events_type_valid
  CHECK (event_type IN (
    'login_success',
    'login_failure',
    'logout',
    'session_compromised',
    'rate_limit_exceeded',
    'inquiry_status_changed',
    'inquiry_exported',
    'password_changed',
    'admin_account_changed',
    'password_reset_completed',
    'inquiry_assigned',
    'inquiry_note_added',
    'inquiry_note_deleted'
  ));

-- The enquiry timeline reads status changes and assignments straight out of
-- this table rather than duplicating them into a second history table. Partial
-- and expression-based, because that timeline is the only query that filters on
-- a key inside `detail`.
CREATE INDEX IF NOT EXISTS security_events_inquiry_idx
  ON security_events ((detail ->> 'inquiryId'), created_at DESC)
  WHERE detail ? 'inquiryId';

CREATE INDEX IF NOT EXISTS security_events_type_created_at_idx
  ON security_events (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS security_events_admin_created_at_idx
  ON security_events (admin_id, created_at DESC);


-- -----------------------------------------------------------------------------
-- rate_limit_hits
--
-- Fixed-window counters for the rate limiter. This lives in Postgres rather than
-- in process memory because the API runs as a serverless function: an in-memory
-- counter would be per-instance, which means the advertised limit would not be
-- the enforced limit as soon as more than one instance is warm.
--
-- The composite primary key is what makes the increment atomic as a single
-- INSERT ... ON CONFLICT DO UPDATE, with no read-modify-write race.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS rate_limit_hits (
  -- Identifies the limited subject, for example 'submit:203.0.113.9' or
  -- 'login:admin@example.com'. Opaque to the database.
  bucket_key   TEXT NOT NULL
               CONSTRAINT rate_limit_hits_bucket_key_length
               CHECK (char_length(bucket_key) BETWEEN 1 AND 300),

  -- Start of the fixed window, floored to the window size by the application.
  window_start TIMESTAMPTZ NOT NULL,

  hit_count    INTEGER NOT NULL DEFAULT 0
               CONSTRAINT rate_limit_hits_count_non_negative CHECK (hit_count >= 0),

  PRIMARY KEY (bucket_key, window_start)
);

-- Sweeping expired windows.
CREATE INDEX IF NOT EXISTS rate_limit_hits_window_start_idx
  ON rate_limit_hits (window_start);


-- -----------------------------------------------------------------------------
-- Lock out the hosting provider's auto-generated API
--
-- Supabase exposes every table in the `public` schema through a REST API backed
-- by the `anon` and `authenticated` roles. This application does not use that
-- API and all of these tables hold either credentials or third-party personal
-- data, so those roles are stripped of access and row-level security is enabled
-- with no policies granting them anything.
--
-- The application connects as the table owner, which is unaffected by RLS unless
-- FORCE ROW LEVEL SECURITY is set, so this is pure defence in depth: it closes
-- a door this application never walks through.
--
-- The role checks keep the script portable to a plain PostgreSQL instance, where
-- those roles do not exist, so the same file can be used for local testing.
-- -----------------------------------------------------------------------------

ALTER TABLE inquiries             ENABLE ROW LEVEL SECURITY;
ALTER TABLE inquiry_notes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE admins                ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens        ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_hits       ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  provider_role TEXT;
BEGIN
  FOREACH provider_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = provider_role) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE inquiries, inquiry_notes, admins, refresh_tokens, password_reset_tokens, security_events, rate_limit_hits FROM %I',
        provider_role
      );
    END IF;
  END LOOP;
END;
$$;

-- -----------------------------------------------------------------------------
-- Enforce the append-only security log
--
-- REVOKE alone does not achieve this. A table's owner holds its privileges
-- implicitly and cannot have them revoked, and this application connects as the
-- owner, so a REVOKE here would look like a control while doing nothing. That
-- was caught by asserting the constraint rather than trusting it.
--
-- A statement-level trigger does bind the owner. FOR EACH STATEMENT rather than
-- FOR EACH ROW so that it fires even when the statement matches no rows, which
-- means `DELETE FROM security_events` is an error rather than a quiet no-op.
--
-- The REVOKE is kept as well, because it still constrains any non-owner role the
-- deployment might later connect with, and least privilege should not depend on
-- the trigger being the only guard.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION reject_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Table %.% is append-only; % is not permitted',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE security_events FROM PUBLIC;

DROP TRIGGER IF EXISTS security_events_no_update ON security_events;
CREATE TRIGGER security_events_no_update
  BEFORE UPDATE ON security_events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

DROP TRIGGER IF EXISTS security_events_no_delete ON security_events;
CREATE TRIGGER security_events_no_delete
  BEFORE DELETE ON security_events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

DROP TRIGGER IF EXISTS security_events_no_truncate ON security_events;
CREATE TRIGGER security_events_no_truncate
  BEFORE TRUNCATE ON security_events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();


-- =============================================================================
-- End of schema.
--
-- Next steps:
--   1. npm run db:seed     provision the first admin from ADMIN_EMAIL / ADMIN_PASSWORD
--   2. npm run dev         start the API and the web app
-- =============================================================================
