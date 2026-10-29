import { describe, expect, it } from 'vitest';
import {
  emailSchema,
  fullNameSchema,
  loginPasswordSchema,
  messageSchema,
  newPasswordSchema,
  PASSWORD_MAX_BYTES,
  phoneSchema,
} from './fields.js';
import { collapseWhitespace, containsControlCharacters, utf8ByteLength } from './text.js';

describe('fullNameSchema', () => {
  it('given surrounding and repeated whitespace, when parsed, then it is trimmed and collapsed', () => {
    expect(fullNameSchema.parse('  Priya    Sharma  ')).toBe('Priya Sharma');
  });

  it('given a name that is only whitespace, when parsed, then it fails the minimum length', () => {
    expect(fullNameSchema.safeParse('   ').success).toBe(false);
  });

  it('given a single character, when parsed, then it is rejected', () => {
    expect(fullNameSchema.safeParse('A').success).toBe(false);
  });

  it('given exactly the maximum length, when parsed, then it is accepted', () => {
    expect(fullNameSchema.safeParse('a'.repeat(120)).success).toBe(true);
  });

  it('given one character over the maximum, when parsed, then it is rejected', () => {
    expect(fullNameSchema.safeParse('a'.repeat(121)).success).toBe(false);
  });

  it('given an embedded newline, when parsed, then it is collapsed to a space rather than rejected', () => {
    // Whitespace control characters are neutralized by normalization, which is
    // why the stored value can never carry a line break into a log or a table
    // cell. Only control characters that normalization cannot remove are errors.
    expect(fullNameSchema.parse('Priya\nSharma')).toBe('Priya Sharma');
  });

  it('given a right-to-left override character, when parsed, then it is rejected', () => {
    // Not whitespace, so normalization cannot remove it; it would let a stored
    // name render as something other than what it contains.
    expect(fullNameSchema.safeParse('Priya\u202eSharma').success).toBe(false);
  });

  it('given a null byte, when parsed, then it is rejected', () => {
    expect(fullNameSchema.safeParse('Priya\u0000Sharma').success).toBe(false);
  });

  it('given a zero-width joiner, when parsed, then it is rejected', () => {
    expect(fullNameSchema.safeParse('Priya\u200dSharma').success).toBe(false);
  });

  it('given a non-Latin script, when parsed, then it is accepted', () => {
    expect(fullNameSchema.parse('प्रिया शर्मा')).toBe('प्रिया शर्मा');
  });
});

describe('emailSchema', () => {
  it('given mixed case and padding, when parsed, then it is lowercased and trimmed', () => {
    expect(emailSchema.parse('  Priya.Sharma@Example.COM ')).toBe('priya.sharma@example.com');
  });

  it.each(['not-an-email', 'missing@tld', '@example.com', 'two@@example.com', ''])(
    'given the invalid address %p, when parsed, then it is rejected',
    (input) => {
      expect(emailSchema.safeParse(input).success).toBe(false);
    },
  );

  it('given an address over the maximum length, when parsed, then it is rejected', () => {
    const tooLong = `${'a'.repeat(250)}@example.com`;
    expect(emailSchema.safeParse(tooLong).success).toBe(false);
  });
});

describe('phoneSchema', () => {
  it('given a number with separators, when parsed, then it is stored canonically', () => {
    expect(phoneSchema.parse('+91 98765-43210')).toBe('+919876543210');
  });

  it('given an invalid number, when parsed, then the message names the expected format', () => {
    const result = phoneSchema.safeParse('12345');

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('Indian mobile number');
  });
});

describe('messageSchema', () => {
  it('given a message with line breaks, when parsed, then the breaks are preserved', () => {
    const multiline = 'Hello there,\n\nI have a question about admissions.';
    expect(messageSchema.parse(multiline)).toBe(multiline);
  });

  it('given a message shorter than the minimum, when parsed, then it is rejected', () => {
    expect(messageSchema.safeParse('too short').success).toBe(false);
  });

  it('given a message at exactly the minimum, when parsed, then it is accepted', () => {
    expect(messageSchema.safeParse('a'.repeat(10)).success).toBe(true);
  });

  it('given a message one character over the maximum, when parsed, then it is rejected', () => {
    expect(messageSchema.safeParse('a'.repeat(2001)).success).toBe(false);
  });

  it('given a null byte, when parsed, then it is rejected even though newlines are allowed', () => {
    expect(messageSchema.safeParse(`A valid length message\u0000`).success).toBe(false);
  });
});

describe('loginPasswordSchema', () => {
  it('given an empty password, when parsed, then it is rejected', () => {
    expect(loginPasswordSchema.safeParse('').success).toBe(false);
  });

  it('given a weak but non-empty password, when parsed, then it is accepted', () => {
    // Sign-in must not enforce policy: doing so would leak the policy and would
    // lock out a credential that predates it.
    expect(loginPasswordSchema.safeParse('abc').success).toBe(true);
  });

  it('given a password of exactly the bcrypt byte limit, when parsed, then it is accepted', () => {
    const atLimit = 'a'.repeat(PASSWORD_MAX_BYTES);

    expect(utf8ByteLength(atLimit)).toBe(PASSWORD_MAX_BYTES);
    expect(loginPasswordSchema.safeParse(atLimit).success).toBe(true);
  });

  it('given one byte over the bcrypt limit, when parsed, then it is rejected rather than truncated', () => {
    expect(loginPasswordSchema.safeParse('a'.repeat(PASSWORD_MAX_BYTES + 1)).success).toBe(false);
  });

  it('given multi-byte characters, when parsed, then the limit is measured in bytes not characters', () => {
    // 24 three-byte characters are 72 bytes and fit; 25 are 75 bytes and do not.
    const atLimit = '\u20ac'.repeat(24);
    const overLimit = '\u20ac'.repeat(25);

    expect(utf8ByteLength(atLimit)).toBe(PASSWORD_MAX_BYTES);
    expect(loginPasswordSchema.safeParse(atLimit).success).toBe(true);
    expect(utf8ByteLength(overLimit)).toBeGreaterThan(PASSWORD_MAX_BYTES);
    expect(loginPasswordSchema.safeParse(overLimit).success).toBe(false);
  });
});

describe('newPasswordSchema', () => {
  it('given a strong password, when parsed, then it is accepted', () => {
    expect(newPasswordSchema.safeParse('Correct-Horse-9').success).toBe(true);
  });

  it.each([
    ['too short', 'Short-1a'],
    ['no uppercase', 'correct-horse-9'],
    ['no lowercase', 'CORRECT-HORSE-9'],
    ['no digit', 'Correct-Horse-Battery'],
  ])('given a password that is %s, when parsed, then it is rejected', (_label, input) => {
    expect(newPasswordSchema.safeParse(input).success).toBe(false);
  });
});

describe('text helpers', () => {
  it('given mixed whitespace, when collapsed, then runs become single spaces', () => {
    expect(collapseWhitespace('a \t\n b')).toBe('a b');
  });

  it('given allowed control characters, when checked, then they are not reported', () => {
    expect(containsControlCharacters('line\nbreak', '\n')).toBe(false);
  });

  it('given a disallowed control character, when checked, then it is reported', () => {
    expect(containsControlCharacters('line\nbreak')).toBe(true);
  });

  it('given an empty string, when measured, then the byte length is zero', () => {
    expect(utf8ByteLength('')).toBe(0);
  });
});
