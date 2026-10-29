/**
 * CSV encoding for the inquiry export.
 *
 * Hand-written rather than delegated to a CSV library because of
 * `neutralizeFormula` below, which most libraries do not do.
 */

/**
 * Characters that make a spreadsheet treat a cell as a formula.
 *
 * Tab and carriage return are included because Excel strips leading whitespace
 * before deciding, so ` =cmd` is still a formula.
 */
const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Prefixes a leading formula trigger with a single quote.
 *
 * The export carries free text submitted by anonymous members of the public, so
 * without this, opening the file executes their content in the staff member's
 * spreadsheet. The quote is the documented way to force a literal in Excel,
 * Google Sheets and LibreOffice.
 */
export function neutralizeFormula(value: string): string {
  const first = value[0];
  return first !== undefined && FORMULA_TRIGGERS.includes(first) ? `'${value}` : value;
}

/**
 * Encodes one field: neutralised, then quoted if it contains anything that
 * would otherwise break the row structure.
 */
export function encodeCsvField(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }

  const safe = neutralizeFormula(value);
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

/** Encodes one row, CRLF-terminated as RFC 4180 specifies. */
export function encodeCsvRow(fields: readonly (string | null | undefined)[]): string {
  return `${fields.map(encodeCsvField).join(',')}\r\n`;
}
