import { Navigate, useLocation } from 'react-router';
import type { ReactNode } from 'react';
import { useSession } from './session';

/**
 * Route guard.
 *
 * Renders from verified session state, never from whether an API call happens
 * to succeed, and preserves the requested path so sign-in returns the user
 * where they were going.
 *
 * This is convenience, not security: every protected endpoint enforces its own
 * authorization server-side regardless of what this renders.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const { state } = useSession();
  const location = useLocation();

  if (state.status === 'loading') {
    return (
      <div
        className="flex min-h-screen items-center justify-center text-ink-muted"
        role="status"
        aria-live="polite"
      >
        <span className="sr-only">Checking your session</span>
        <span
          aria-hidden="true"
          className="size-6 animate-spin rounded-full border-2 border-ink-faint border-t-transparent"
        />
      </div>
    );
  }

  if (state.status === 'anonymous') {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
