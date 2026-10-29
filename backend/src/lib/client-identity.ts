import { isIPv4, isIPv6 } from 'node:net';

/**
 * A residential or mobile IPv6 client typically holds a whole /64, so limiting
 * per full address is free to evade. Collapsing to the /64 makes the key as
 * hard to rotate as an IPv4 address.
 */
const IPV6_SUBSCRIBER_PREFIX_HEXTETS = 4;
const IPV6_HEXTET_COUNT = 8;

/** Expands a compressed IPv6 address to its eight hextets, or undefined. */
function expandIPv6(address: string): string[] | undefined {
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
 * free: IPv4 unchanged, IPv6 collapsed to its /64.
 *
 * An unrecognisable value is returned verbatim, so such callers get distinct
 * keys rather than sharing one bucket.
 */
export function normalizeClientAddress(address: string): string {
  if (isIPv4(address)) {
    return address;
  }
  if (!isIPv6(address)) {
    return address;
  }

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
 * Namespaces a key by purpose, so traffic to one endpoint cannot consume
 * another endpoint's allowance for the same subject.
 */
export function rateLimitKey(purpose: string, subject: string): string {
  return `${purpose}:${subject}`;
}
