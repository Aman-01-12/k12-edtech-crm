import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router';
import type { AuthenticatedAdmin } from '@k12/contracts';
import { ApiRequestError, api, setSessionEndedHandler } from '../../lib/api-client';

/**
 * Session state for the whole app.
 *
 * The source of truth is the server: this asks `/auth/me` rather than decoding
 * a token, because the tokens live in cookies the page cannot read and because
 * the server is the only thing that knows whether the account is still active.
 */

type SessionState =
  | { status: 'loading' }
  | { status: 'authenticated'; admin: AuthenticatedAdmin }
  | { status: 'anonymous' };

interface SessionContextValue {
  state: SessionState;
  signIn: (admin: AuthenticatedAdmin) => void;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  const refresh = useCallback(async () => {
    try {
      const result = await api.get<{ admin: AuthenticatedAdmin }>('/auth/me');
      setState({ status: 'authenticated', admin: result.admin });
    } catch (error) {
      // A 401 here is the expected answer for a visitor who is not signed in,
      // so it sets anonymous rather than surfacing an error.
      if (error instanceof ApiRequestError) {
        setState({ status: 'anonymous' });
        return;
      }
      setState({ status: 'anonymous' });
    }
  }, []);

  /**
   * Probed once, and only for the admin surface.
   *
   * The public form has no use for a session, so probing there spent a request
   * on every visit to the busiest page and logged an expected 401 to the
   * console, which reads like a fault. The ref makes it fire once rather than
   * on every navigation within `/admin`.
   */
  const { pathname } = useLocation();
  const needsSession = pathname.startsWith('/admin');
  const probed = useRef(false);

  useEffect(() => {
    if (!needsSession || probed.current) {
      return;
    }
    probed.current = true;
    void refresh();
  }, [needsSession, refresh]);

  // The api client calls this when a session becomes unrecoverable, so a 401
  // deep inside any query drops the whole app to signed-out in one place.
  useEffect(() => {
    setSessionEndedHandler(() => setState({ status: 'anonymous' }));
    return () => setSessionEndedHandler(undefined);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      // Local state clears even if the server call failed, so the user is not
      // stuck looking at a dashboard they believe they left.
      setState({ status: 'anonymous' });
    }
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      state,
      signIn: (admin) => setState({ status: 'authenticated', admin }),
      signOut,
      refresh,
    }),
    [state, signOut, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (context === undefined) {
    throw new Error('useSession must be used inside a SessionProvider');
  }
  return context;
}
