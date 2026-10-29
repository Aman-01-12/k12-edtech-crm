import { API_ERROR_CODES, type ApiError } from '@k12/contracts';

/**
 * The single path to the API.
 *
 * Owns four things that must not be reimplemented per call site: the request
 * timeout, the CSRF header, the one-flight token refresh with replay, and the
 * mapping from a failure to a message a user can read.
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';
const API_V1 = `${BASE_URL}/v1`;

const DEFAULT_TIMEOUT_MS = 15_000;

/** The readable cookie the server issues for double-submit CSRF. */
const CSRF_COOKIE = 'k12_csrf';
const CSRF_HEADER = 'X-CSRF-Token';

export class ApiRequestError extends Error {
  // Declared and assigned rather than using parameter properties, which
  // `erasableSyntaxOnly` forbids because they emit runtime code.
  readonly status: number;
  /**
   * Typed as `string` rather than the code union: the server may add a code
   * this bundle has not been rebuilt for, and a union with `string` collapses
   * to `string` anyway. Compare against `API_ERROR_CODES` members.
   */
  readonly code: string;
  readonly details: Record<string, string[]> | undefined;
  readonly requestId: string | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, string[]>,
    requestId?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  /** Field-level messages, for attaching a server rejection to form fields. */
  fieldErrors(): Record<string, string[]> {
    return this.details ?? {};
  }
}

/** Raised when the request was cancelled because the caller went away. */
export class RequestAbortedError extends Error {
  constructor() {
    super('The request was cancelled.');
    this.name = 'RequestAbortedError';
  }
}

function readCsrfToken(): string | undefined {
  for (const part of document.cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === CSRF_COOKIE) {
      const value = rest.join('=');
      return value.length > 0 ? decodeURIComponent(value) : undefined;
    }
  }
  return undefined;
}

/**
 * Turns a failure into something a user can act on.
 *
 * The server already sanitizes its messages, so this exists for the cases it
 * cannot describe: the network being unreachable, and a response that is not
 * the error contract at all.
 */
function toApiError(status: number, payload: unknown, fallback: string): ApiRequestError {
  if (typeof payload === 'object' && payload !== null && 'code' in payload) {
    const body = payload as ApiError;
    return new ApiRequestError(status, body.code, body.error, body.details, body.requestId);
  }
  return new ApiRequestError(status, 'UNKNOWN', fallback);
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Set when replaying after a refresh, so a replay cannot refresh again. */
  isReplay?: boolean;
}

/**
 * One shared in-flight refresh.
 *
 * Several requests can fail with an expired token in the same moment. Without
 * this, each would start its own rotation, and because rotation revokes the
 * presented token, the second one would present an already-rotated token and
 * trip the theft detection, logging the user out for being busy.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${API_V1}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      // Cleared in a microtask so every caller awaiting this promise observes
      // the same result before a new attempt can begin.
      queueMicrotask(() => {
        refreshInFlight = null;
      });
    }
  })();

  return refreshInFlight;
}

/** Callbacks for when the session ends for good, wired up by the auth provider. */
let onSessionEnded: (() => void) | undefined;

export function setSessionEndedHandler(handler: (() => void) | undefined): void {
  onSessionEnded = handler;
}

export async function apiRequest<Result>(
  path: string,
  options: RequestOptions = {},
): Promise<Result> {
  const { method = 'GET', body, signal, headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  // Two reasons a request can be cancelled, and they must be distinguishable:
  // a timeout is worth telling the user about, an unmount is not.
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
  const composite =
    signal === undefined
      ? timeoutController.signal
      : AbortSignal.any([signal, timeoutController.signal]);

  const requestHeaders: Record<string, string> = { ...headers };
  if (body !== undefined) {
    requestHeaders['Content-Type'] = 'application/json';
  }
  if (method !== 'GET') {
    const csrf = readCsrfToken();
    if (csrf !== undefined) {
      requestHeaders[CSRF_HEADER] = csrf;
    }
  }

  // `body` is spread conditionally rather than set to undefined, because
  // exactOptionalPropertyTypes distinguishes an absent property from one
  // explicitly set to undefined and RequestInit does not accept the latter.
  const init: RequestInit = {
    method,
    credentials: 'include',
    headers: requestHeaders,
    signal: composite,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };

  let response: Response;
  try {
    response = await fetch(`${API_V1}${path}`, init);
  } catch {
    // The two abort reasons must stay distinguishable: an unmount is silent,
    // a timeout is worth telling the user about.
    if (signal?.aborted === true) {
      throw new RequestAbortedError();
    }
    if (timeoutController.signal.aborted) {
      throw new ApiRequestError(
        0,
        'TIMEOUT',
        'The server took too long to respond. Please try again.',
      );
    }
    throw new ApiRequestError(0, 'NETWORK', 'Could not reach the server. Check your connection.');
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 204) {
    return undefined as Result;
  }

  // A body that is not JSON is not an error here: the caller gets `undefined`
  // and the status decides, which is what a 304 or an empty 200 needs.
  const payload: unknown = await response.json().catch(() => undefined);

  if (response.ok) {
    return payload as Result;
  }

  const error = toApiError(response.status, payload, 'Something went wrong. Please try again.');

  // An expired token is recoverable: refresh once, then replay. Anything else
  // 401 means the session is unrecoverable and the user must sign in again.
  if (error.code === API_ERROR_CODES.tokenExpired && options.isReplay !== true) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return apiRequest<Result>(path, { ...options, isReplay: true });
    }
    onSessionEnded?.();
    throw error;
  }

  if (
    error.code === API_ERROR_CODES.tokenInvalid ||
    error.code === API_ERROR_CODES.sessionCompromised
  ) {
    onSessionEnded?.();
  }

  throw error;
}

export const api = {
  get: <Result>(path: string, signal?: AbortSignal) =>
    apiRequest<Result>(path, { method: 'GET', ...(signal === undefined ? {} : { signal }) }),
  post: <Result>(path: string, body?: unknown, headers?: Record<string, string>) =>
    apiRequest<Result>(path, {
      method: 'POST',
      ...(body === undefined ? {} : { body }),
      ...(headers === undefined ? {} : { headers }),
    }),
  patch: <Result>(path: string, body?: unknown) =>
    apiRequest<Result>(path, { method: 'PATCH', ...(body === undefined ? {} : { body }) }),
  delete: <Result>(path: string) => apiRequest<Result>(path, { method: 'DELETE' }),
};

/** Absolute URL for a download, which must be a real navigation rather than fetch. */
export function apiDownloadUrl(path: string): string {
  return `${API_V1}${path}`;
}
