import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import './index.css';
import { InquiryFormPage } from './features/inquiry-form/InquiryFormPage';
import { RequireSession } from './features/auth/RequireSession';
import { SessionProvider } from './features/auth/session';

/**
 * The admin surface is loaded on demand.
 *
 * The public form is what most visitors see, and there is no reason for a
 * parent sending an enquiry on a phone to download the dashboard, its data
 * table and the admin screens. Eagerly bundling all of it put every route in
 * one 204 kB chunk.
 */
const LoginPage = lazy(async () => ({
  default: (await import('./features/auth/LoginPage')).LoginPage,
}));
const DashboardPage = lazy(async () => ({
  default: (await import('./features/dashboard/DashboardPage')).DashboardPage,
}));
const SettingsPage = lazy(async () => ({
  default: (await import('./features/settings/SettingsPage')).SettingsPage,
}));

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center" role="status" aria-live="polite">
      <span className="sr-only">Loading</span>
      <span
        aria-hidden="true"
        className="size-6 animate-spin rounded-full border-2 border-ink-faint border-t-transparent"
      />
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // A 401 is handled by the api client's interceptor; retrying it here
      // would multiply refresh attempts for no benefit.
      retry: (failureCount, error) =>
        failureCount < 2 && !(error instanceof Error && error.name === 'ApiRequestError'),
      refetchOnWindowFocus: false,
    },
  },
});

const root = document.getElementById('root');
if (root === null) {
  throw new Error('Root element not found');
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SessionProvider>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<InquiryFormPage />} />
              <Route path="/admin/login" element={<LoginPage />} />
              <Route
                path="/admin/inquiries"
                element={
                  <RequireSession>
                    <DashboardPage />
                  </RequireSession>
                }
              />
              <Route
                path="/admin/settings"
                element={
                  <RequireSession>
                    <SettingsPage />
                  </RequireSession>
                }
              />
              <Route path="/admin" element={<Navigate to="/admin/inquiries" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </SessionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
