import type { ReactNode } from 'react';

/**
 * The shared frame for the four unauthenticated auth screens, so sign-in,
 * forgot-password and reset-password cannot drift apart visually.
 */
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-12">
      <div className="rounded-card border border-edge bg-surface p-7 shadow-sm">
        <p className="font-display text-xs font-semibold tracking-[0.18em] text-marigold-deep uppercase">
          K12 Hunar
        </p>
        <h1 className="mt-2 font-display text-2xl font-bold text-ink">{title}</h1>
        {children}
      </div>
    </main>
  );
}
