/**
 * Indian phone number normalization.
 *
 * Every stored number is canonicalised to E.164 (`+91` followed by ten digits)
 * so that one person's number has exactly one representation. The admin search
 * depends on this: a substring match against inconsistently formatted numbers
 * silently misses rows.
 *
 * Scope is deliberately India-only, matching the audience. See
 * `docs/adr/0006-phone-number-validation.md` for the rejected alternatives and
 * the upgrade path to full international parsing.
 */

/** India's mobile numbering plan: ten digits, first digit 6 to 9. */
const INDIAN_MOBILE_PATTERN = /^[6-9]\d{9}$/;

const COUNTRY_CODE = '+91';

/** Digits and a single leading plus are meaningful; separators are not. */
const SEPARATORS_PATTERN = /[\s().\-\u2010-\u2015]/g;

/**
 * Strips the country or trunk prefix from a digit string, returning the ten
 * digit national number.
 *
 * Length is what disambiguates: a leading `91` is a country code only when the
 * string is twelve digits long, otherwise it is part of a subscriber number.
 */
function toNationalNumber(digits: string): string | undefined {
  if (digits.length === 10) {
    return digits;
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return digits.slice(1);
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2);
  }
  if (digits.length === 14 && digits.startsWith('0091')) {
    return digits.slice(4);
  }
  return undefined;
}

/**
 * Normalizes a user-supplied Indian phone number to E.164.
 *
 * @param raw - the number as typed, which may contain spaces, hyphens,
 *   parentheses, dots, a `+91` or `0091` country prefix, or a `0` trunk prefix.
 * @returns the number as `+91XXXXXXXXXX`, or `undefined` when the input is not
 *   a valid Indian mobile number.
 */
export function normalizeIndianPhone(raw: string): string | undefined {
  const compact = raw.replace(SEPARATORS_PATTERN, '');

  // A plus is only meaningful as a country-code marker in first position.
  const withoutPlus = compact.startsWith('+') ? compact.slice(1) : compact;
  if (withoutPlus.includes('+') || !/^\d+$/.test(withoutPlus)) {
    return undefined;
  }

  const national = toNationalNumber(withoutPlus);
  if (national === undefined || !INDIAN_MOBILE_PATTERN.test(national)) {
    return undefined;
  }

  return `${COUNTRY_CODE}${national}`;
}

/**
 * Reduces a phone search term to the digits a stored E.164 number would
 * contain, so that `+91 98765 43210`, `098765 43210` and `9876543210` all match
 * the same row.
 *
 * @returns the digit substring to match, or `undefined` when the term holds no
 *   digits and therefore cannot be a phone search.
 */
export function toPhoneSearchFragment(term: string): string | undefined {
  const digits = term.replace(/\D/g, '');
  if (digits.length === 0) {
    return undefined;
  }
  // A leading trunk zero is never stored, so keeping it would match nothing.
  const withoutTrunkPrefix = digits.startsWith('0') ? digits.replace(/^0+/, '') : digits;
  return withoutTrunkPrefix.length === 0 ? undefined : withoutTrunkPrefix;
}
