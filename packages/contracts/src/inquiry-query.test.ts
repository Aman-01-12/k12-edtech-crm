import { describe, expect, it } from 'vitest';
import {
  listInquiriesQuerySchema,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  SEARCH_MIN_LENGTH,
} from './inquiry-query.js';

describe('listInquiriesQuerySchema', () => {
  it('given no parameters, when parsed, then only the default page size is applied', () => {
    expect(listInquiriesQuerySchema.parse({})).toEqual({ limit: PAGE_SIZE_DEFAULT });
  });

  it('given both filters, when parsed, then both are retained', () => {
    const parsed = listInquiriesQuerySchema.parse({ category: 'concert', userType: 'school' });

    expect(parsed.category).toBe('concert');
    expect(parsed.userType).toBe('school');
  });

  it('given a cleared select submitted as an empty string, when parsed, then the filter is absent', () => {
    // An empty string is the query-string spelling of "no filter", not an
    // invalid filter value.
    const parsed = listInquiriesQuerySchema.parse({ category: '', userType: '', search: '' });

    expect(parsed.category).toBeUndefined();
    expect(parsed.userType).toBeUndefined();
    expect(parsed.search).toBeUndefined();
  });

  it('given a category outside the permitted set, when parsed, then it is rejected', () => {
    // Rejecting matters: silently dropping the filter would return the whole
    // table while looking like a working filter.
    expect(listInquiriesQuerySchema.safeParse({ category: 'sports' }).success).toBe(false);
  });

  it('given an unknown parameter, when parsed, then it is rejected', () => {
    expect(listInquiriesQuerySchema.safeParse({ userTyp: 'parent' }).success).toBe(false);
  });

  it('given a repeated parameter arriving as an array, when parsed, then it is rejected', () => {
    expect(listInquiriesQuerySchema.safeParse({ category: ['concert', 'admission'] }).success).toBe(
      false,
    );
  });

  it('given a search term shorter than the minimum, when parsed, then it is rejected', () => {
    expect(listInquiriesQuerySchema.safeParse({ search: 'a' }).success).toBe(false);
  });

  it('given a search term at the minimum length, when parsed, then it is accepted', () => {
    const parsed = listInquiriesQuerySchema.parse({ search: 'a'.repeat(SEARCH_MIN_LENGTH) });

    expect(parsed.search).toBe('a'.repeat(SEARCH_MIN_LENGTH));
  });

  it('given a padded search term, when parsed, then it is trimmed', () => {
    expect(listInquiriesQuerySchema.parse({ search: '  Priya  ' }).search).toBe('Priya');
  });

  it('given a numeric limit as a string, when parsed, then it is coerced', () => {
    expect(listInquiriesQuerySchema.parse({ limit: '50' }).limit).toBe(50);
  });

  it('given a limit above the cap, when parsed, then it is rejected rather than clamped', () => {
    // Rejecting tells the caller their page size was not honoured; clamping
    // silently would not.
    expect(listInquiriesQuerySchema.safeParse({ limit: String(PAGE_SIZE_MAX + 1) }).success).toBe(
      false,
    );
  });

  it.each(['0', '-1', '1.5', 'all'])(
    'given the invalid limit %p, when parsed, then it is rejected',
    (limit) => {
      expect(listInquiriesQuerySchema.safeParse({ limit }).success).toBe(false);
    },
  );

  it('given a malformed cursor, when parsed, then it is rejected', () => {
    expect(listInquiriesQuerySchema.safeParse({ cursor: 'not base64url!!' }).success).toBe(false);
  });
});
