import type { ClientRateLimitInfo, Options, Store } from 'express-rate-limit';
import { pool } from '../db/pool.js';
import { logger } from '../lib/logger.js';

/**
 * Sliding-window-counter store backed by Postgres.
 *
 * In Postgres rather than memory because the API runs as a serverless function,
 * where a per-instance counter would make the enforced limit scale with the
 * number of warm instances. Sliding rather than fixed because a fixed window
 * admits twice the allowance across a boundary. See docs/adr/0005.
 */

interface SlidingWindowRow extends Record<string, unknown> {
  current_hits: number;
  previous_hits: number;
}

/**
 * Bumps the current window and reads the previous one in one statement, so the
 * increment is atomic and the weighting cannot be computed from torn reads.
 */
const INCREMENT_SQL = `
  with bumped as (
    insert into rate_limit_hits (bucket_key, window_start, hit_count)
    values ($1, $2, 1)
    on conflict (bucket_key, window_start)
    do update set hit_count = rate_limit_hits.hit_count + 1
    returning hit_count
  )
  select
    (select hit_count from bumped) as current_hits,
    coalesce(
      (select hit_count from rate_limit_hits where bucket_key = $1 and window_start = $3),
      0
    ) as previous_hits
`;

const PEEK_SQL = `
  select
    coalesce((select hit_count from rate_limit_hits where bucket_key = $1 and window_start = $2), 0) as current_hits,
    coalesce((select hit_count from rate_limit_hits where bucket_key = $1 and window_start = $3), 0) as previous_hits
`;

const SWEEP_WINDOW_MULTIPLE = 3;

export class PostgresRateLimitStore implements Store {
  /** Counters are shared through the database, so instances are not isolated. */
  readonly localKeys = false;

  private windowMs = 60_000;

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private boundaries(now: number): { current: Date; previous: Date; elapsedFraction: number } {
    const currentStartMs = Math.floor(now / this.windowMs) * this.windowMs;
    return {
      current: new Date(currentStartMs),
      previous: new Date(currentStartMs - this.windowMs),
      elapsedFraction: (now - currentStartMs) / this.windowMs,
    };
  }

  /** Rounded up, so a partial hit counts and a caller cannot sit under the limit. */
  private estimate(row: SlidingWindowRow, elapsedFraction: number): number {
    return Math.ceil(row.previous_hits * (1 - elapsedFraction) + row.current_hits);
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const now = Date.now();
    const { current, previous, elapsedFraction } = this.boundaries(now);

    const { rows } = await pool.query<SlidingWindowRow>(INCREMENT_SQL, [key, current, previous]);
    const row = rows[0] ?? { current_hits: 1, previous_hits: 0 };

    return {
      totalHits: this.estimate(row, elapsedFraction),
      resetTime: new Date(current.getTime() + this.windowMs),
    };
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const now = Date.now();
    const { current, previous, elapsedFraction } = this.boundaries(now);

    const { rows } = await pool.query<SlidingWindowRow>(PEEK_SQL, [key, current, previous]);
    const row = rows[0];
    if (row === undefined) {
      return undefined;
    }

    return {
      totalHits: this.estimate(row, elapsedFraction),
      resetTime: new Date(current.getTime() + this.windowMs),
    };
  }

  /** Used by `skipSuccessfulRequests`, so a successful sign-in costs nothing. */
  async decrement(key: string): Promise<void> {
    const { current } = this.boundaries(Date.now());
    await pool.query(
      `update rate_limit_hits
          set hit_count = greatest(hit_count - 1, 0)
        where bucket_key = $1 and window_start = $2`,
      [key, current],
    );
  }

  async resetKey(key: string): Promise<void> {
    await pool.query('delete from rate_limit_hits where bucket_key = $1', [key]);
  }

  /**
   * Called opportunistically rather than on a timer, since a serverless
   * instance has no reliable scheduler and a leaked interval would keep it alive.
   */
  async sweepExpired(): Promise<number> {
    const cutoff = new Date(Date.now() - this.windowMs * SWEEP_WINDOW_MULTIPLE);
    const { rowCount } = await pool.query('delete from rate_limit_hits where window_start < $1', [
      cutoff,
    ]);
    return rowCount ?? 0;
  }
}

/**
 * One store per limiter, never shared: each limiter calls `init` with its own
 * window, so a shared instance would leave every limiter using whichever
 * initialised last.
 */
export function createRateLimitStore(): PostgresRateLimitStore {
  return new PostgresRateLimitStore();
}

/**
 * Paired with `passOnStoreError: true`. A database blip must not lock every
 * admin out of signing in; the same trade would be wrong for an authorization
 * check, which fails closed.
 */
export function logRateLimitProblem(error: unknown, message?: string): void {
  logger.warn({ err: error }, message ?? 'Rate limiter reported a problem');
}
