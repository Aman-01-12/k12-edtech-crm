import { isIPv4, isIPv6 } from 'node:net';

/**
 * Deriving a rate-limit subject from a request.
 *
 * The guiding rule is to key on the most specific identity available, because
 * every less specific key punishes someone who did nothing. An authenticated
 * action keys on the account. A credential-bearing action keys on both the
 * account and the network, because neither alone covers both attack shapes. An
 * anonymous action has only the network to go on, which is the weakest case and
 * the one these helpers exist to make less wrong.
 *
 * See docs/adr/0005-rate-limiting-and-idempotency.md.
 */

/**
 * How much of an IPv6 address identifies a subscriber.
 *
 * A residential or mobile IPv6 customer is typically delegated a whole /64 or
 * larger, so limiting per full address is trivially evaded: the client simply
 * picks another address from its own prefix. Collapsing to the /64 makes the
 * key as hard to rotate as an IPv4 address is.
 */
const IPV6_SUBSCRIBER_PREFIX_HEXTETS = 4;

/** Hextets in a fully expanded IPv6 address. */
const IPV6_HEXTET_COUNT = 8;

/**
 * Expands a compressed IPv6 address to its eight hextets.
 *
 * Written out rather than taken from a library because the only operation
 * needed is prefix truncation, and the `::` expansion rule is the whole of it.
 *
 * @returns the eight hextets, or `undefined` if the input is not expandable.
 */
function expandIPv6(address: string): string[] | undefined {
  // An IPv4-mapped address such as ::ffff:203.0.113.9 carries an IPv4 subject,
  // handled by the caller before this point.
  const [head, tail, ...extra] = address.split('::');
  if (extra.length > 0 || head === undefined) {
    return undefined;
  }

  const headGroups = head.length > 0 ? head.split(':') : [];
  const tailGroups = tail !== undefined && tail.length > 0 ? tail.split(':') : [];

  if (tail === undefined) {
    return headGroups.length === IPV6_HEXTET_COUNT ? headGroups : undefined;
  }

  const missing = IPV6_HEXTET_COUNT - headGroups.length - tailGroups.length;
  if (missing < 0) {
    return undefined;
  }

  return [...headGroups, ...Array.from({ length: missing }, () => '0'), ...tailGroups];
}

/**
 * Reduces a client address to the narrowest subject that cannot be rotated for
 * free.
 *
 * IPv4 is returned as-is. IPv6 is collapsed to its /64 prefix. An
 * unrecognisable value is returned verbatim so it still forms a stable key
 * rather than silently collapsing every such caller into one bucket.
 */
export function normalizeClientAddress(address: string): string {
  if (isIPv4(address)) {
    return address;
  }

  if (!isIPv6(address)) {
    return address;
  }

  // ::ffff:a.b.c.d is an IPv4 client arriving over a v6 socket.
  const mappedIPv4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mappedIPv4?.[1] !== undefined && isIPv4(mappedIPv4[1])) {
    return mappedIPv4[1];
  }

  const hextets = expandIPv6(address.split('%')[0] ?? address);
  if (hextets === undefined) {
    return address;
  }

  return `${hextets.slice(0, IPV6_SUBSCRIBER_PREFIX_HEXTETS).join(':')}::/64`;
}

/**
 * Builds a namespaced rate-limit key.
 *
 * The purpose prefix matters: without it, traffic to one endpoint would consume
 * another endpoint's budget for the same subject, so a burst of form
 * submissions could lock an admin out of signing in.
 */
export function rateLimitKey(purpose: string, subject: string): string {
  return `${purpose}:${subject}`;
}
