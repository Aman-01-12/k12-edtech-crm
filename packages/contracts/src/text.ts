/** Shared text predicates and normalizers used by the field schemas. */

/** Collapses runs of whitespace to a single space. Assumes an already-trimmed value. */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ');
}

/** Control and format characters, which no user-entered field has a use for. */
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;

/**
 * Reports whether a value contains control or format characters, which are a
 * vector for log injection and for hiding content behind bidirectional
 * overrides.
 *
 * @param value - the string to inspect.
 * @param allowed - characters to permit despite being control characters, used
 *   to keep real line breaks in multi-line text.
 */
export function containsControlCharacters(value: string, allowed = ''): boolean {
  for (const character of value) {
    if (CONTROL_OR_FORMAT.test(character) && !allowed.includes(character)) {
      return true;
    }
  }
  return false;
}

/** Line breaks and tabs are legitimate inside a free-text message. */
export const TEXT_BLOCK_ALLOWED_CONTROLS = '\n\r\t';

/** Measures a string in UTF-8 bytes, which is the unit bcrypt's input limit uses. */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
