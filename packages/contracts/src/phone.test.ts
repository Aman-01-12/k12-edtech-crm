import { describe, expect, it } from 'vitest';
import { normalizeIndianPhone, toPhoneSearchFragment } from './phone.js';

describe('normalizeIndianPhone', () => {
  it('given a bare ten-digit mobile number, when normalized, then it gains the country code', () => {
    expect(normalizeIndianPhone('9876543210')).toBe('+919876543210');
  });

  it.each([
    ['spaces', '98765 43210'],
    ['hyphens', '98765-43210'],
    ['parentheses', '(98765) 43210'],
    ['dots', '98765.43210'],
    ['an en dash', '98765\u201343210'],
    ['a plus country code', '+91 98765 43210'],
    ['a bare country code', '91 98765 43210'],
    ['a double-zero country code', '0091 98765 43210'],
    ['a trunk zero', '0 98765 43210'],
  ])(
    'given a number written with %s, when normalized, then it reduces to the same canonical form',
    (_label, input) => {
      expect(normalizeIndianPhone(input)).toBe('+919876543210');
    },
  );

  it.each([
    ['too few digits', '987654321'],
    ['too many digits', '98765432100'],
    ['an invalid leading digit', '5876543210'],
    ['letters', '98765abcde'],
    ['empty', ''],
    ['only separators', '--- ---'],
    ['a non-Indian country code', '+1 2025550123'],
    ['a plus in a later position', '9876+43210'],
    ['two plus signs', '++919876543210'],
  ])('given %s, when normalized, then it is rejected', (_label, input) => {
    expect(normalizeIndianPhone(input)).toBeUndefined();
  });

  it('given a twelve-digit number not starting with the country code, when normalized, then it is rejected', () => {
    // Length-based prefix stripping must not invent a country code.
    expect(normalizeIndianPhone('987654321098')).toBeUndefined();
  });

  it.each(['6', '7', '8', '9'])(
    'given a mobile number starting with %s, when normalized, then it is accepted',
    (leadingDigit) => {
      expect(normalizeIndianPhone(`${leadingDigit}876543210`)).toBe(`+91${leadingDigit}876543210`);
    },
  );
});

describe('toPhoneSearchFragment', () => {
  it('given a term with separators, when reduced, then only digits remain', () => {
    expect(toPhoneSearchFragment('+91 98765-43210')).toBe('919876543210');
  });

  it('given a partial number, when reduced, then the digits are preserved for a substring match', () => {
    expect(toPhoneSearchFragment('98765')).toBe('98765');
  });

  it('given a term with a leading trunk zero, when reduced, then the zero is dropped', () => {
    // Stored numbers are E.164 and never contain a trunk zero, so keeping it
    // would match nothing.
    expect(toPhoneSearchFragment('098765')).toBe('98765');
  });

  it('given a term with no digits, when reduced, then it is not a phone search', () => {
    expect(toPhoneSearchFragment('Priya')).toBeUndefined();
  });

  it('given a term of only zeroes, when reduced, then it is not a phone search', () => {
    expect(toPhoneSearchFragment('000')).toBeUndefined();
  });

  it('given a canonical stored number, when its own fragment is derived, then it matches that number as a substring', () => {
    // This is the invariant the dashboard phone search depends on: however the
    // admin types the number, the reduced fragment must occur in the stored form.
    const stored = normalizeIndianPhone('98765 43210') ?? '';
    const fragment = toPhoneSearchFragment('+91 98765 43210') ?? '';

    expect(stored).toBe('+919876543210');
    expect(fragment).not.toBe('');
    expect(stored.includes(fragment)).toBe(true);
  });
});
