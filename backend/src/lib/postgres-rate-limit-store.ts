import type { ClientRateLimitInfo, Options, Store } from 'express-rate-limit';
import { pool } from '../db/pool.js';
import { logger } from '../lib/logger.js';

/**
 * A sliding-window-counter rate limit store backed by Postgres.
 *
 * Two decisions are worth explaining.
 *
 * **Why Postgres and not memory.** The API runs as a serverless function, so an
 * in-memory counter is per-instance. With several instances warm, the
 * advertised limit would not be the enforced limit, and the limit would quietly
 * scale with traffic, which is precisely backwards.
 *
 * **Why a sliding window and not a fixed one.** A fixed window admits up to
 * twice the limit across a boundary: an attacker sends the full allowance in the
 * last instant of one window and again in the first instant of the next. The
 * sliding window counter removes that by weighting the previous window's count
 * by how much of it is still in view. It costs one extra row in the same query
 * and the same O(1) storage per subject, so there is no reason to keep the
 * weaker algorithm.
 *
 * Estimated hits are `previous * (1 - elapsed fraction) + current`, the standard
 * approximation. It assumes the previous window's requests were spread evenly,
 * which is wrong in the attacker's favour by less than one window's worth and is
 * why this is an approximation rather than a log.
 */

interface SlidingWindowRow extends Record<string, unknown> {
  current_hits: number;
  previous_hits: number;
}

/**
 * Increments the current window and reads the previous one in a single
 * statement.
 *
 * The upsert is what makes the increment atomic: there is no read-modify-write
 * for two concurrent requests to interleave within. Both windows are fetched
 * together so the weighting cannot be computed from a torn pair of reads.
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

/** Rows older than this many windows can never contribute to an estimate. */
const SWEEP_WINDOW_MULTIPLE = 3;

export class PostgresRateLimitStore implements Store {
  /** Counters are shared through the database, so instances are not isolated. */
  readonly localKeys = false;

  private windowMs = 60_000;

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  /**
   * Floors a timestamp to its window boundary.
   *
   * Both the current and previous boundaries are derived from the same instant,
   * so they are always exactly one window apart.
   */
  private boundaries(now: number): { current: Date; previous: Date; elapsedFraction: number } {
    const currentStartMs = Math.floor(now / this.windowMs) * this.windowMs;
    return {
      current: new Date(currentStartMs),
      previous: new Date(currentStartMs - this.windowMs),
      elapsedFraction: (now - currentStartMs) / this.windowMs,
    };
  }

  /**
   * Weights the previous window by the portion still inside the sliding window.
   *
   * Rounded up so a partial hit counts as a hit: rounding down would let a
   * caller sit permanently just under the limit.
   */
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
      // The window a caller must wait out is the current one, since the
      // previous window's weight only ever decreases.
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

  /**
   * Undoes one hit.
   *
   * Used by `skipSuccessfulRequests`, which is how a successful sign-in avoids
   * consuming the failed-attempt budget. Floored at zero by the column's own
   * check constraint, so a double decrement cannot drive the count negative.
   */
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
   * Removes windows too old to affect any estimate.
   *
   * Called opportunistically rather than on a timer, because a serverless
   * instance has no reliable background scheduler and a leaked interval would
   * keep it alive.
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
 * One store per limiter, never shared.
 *
 * Each limiter calls `init` with its own `windowMs`, and the store keeps that
 * window in instance state. Sharing an instance would leave every limiter using
 * whichever window initialised last, so a 15-minute sign-in limit could silently
 * become a 1-minute one. express-rate-limit rejects a shared store for exactly
 * this reason; the rows stay shared through the database, which is what makes
 * the limit hold across instances.
 */
export function createRateLimitStore(): PostgresRateLimitStore {
  return new PostgresRateLimitStore();
}

/**
 * Logs a problem reported by a limiter.
 *
 * Paired with `passOnStoreError: true`: if the counter is unreachable the
 * request is allowed. A database blip must not lock every admin out of signing
 * in, and an attacker who can break the counter can already break the
 * application. The same trade would be wrong for an authorization check, which
 * fails closed.
 */
export function logRateLimitProblem(error: unknown, message?: string): void {
  logger.warn({ err: error }, message ?? 'Rate limiter reported a problem');
}
