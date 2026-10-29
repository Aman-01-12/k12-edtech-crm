/**
 * The escape character used with every LIKE and ILIKE pattern this application
 * builds. Declared alongside the escaper so the SQL and the escaping cannot
 * disagree about which character is special.
 */
export const LIKE_ESCAPE_CHARACTER = '\\';

/**
 * Escapes the characters LIKE treats as wildcards, so a search term matches
 * itself literally.
 *
 * Without this, searching for `100%` matches every row and searching for `a_b`
 * matches `axb`. The backslash is escaped first, or escaping the wildcards
 * would then double-escape the backslashes this function just added.
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/** Wraps an escaped term in wildcards for a substring match. */
export function toContainsPattern(term: string): string {
  return `%${escapeLikePattern(term)}%`;
}
