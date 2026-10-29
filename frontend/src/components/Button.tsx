import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: Variant;
  /** Disables the control and announces the wait. */
  busy?: boolean;
  busyLabel?: string;
  children: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  // Marigold is spent here and nowhere else on a screen; see ADR 0009.
  primary: 'bg-marigold text-white hover:bg-marigold-deep border-transparent',
  secondary: 'bg-surface text-ink border-edge hover:border-ink-faint',
  ghost: 'bg-transparent text-ink-muted border-transparent hover:text-ink hover:bg-canvas',
  danger: 'bg-surface text-clay border-edge hover:bg-clay-wash hover:border-clay',
};

/**
 * `busy` disables at the state level rather than only styling the control,
 * because a button that merely looks disabled can still be double-submitted.
 */
export function Button({
  variant = 'secondary',
  busy = false,
  busyLabel = 'Working',
  disabled = false,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy ? true : undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]}`}
    >
      {busy ? (
        <>
          <span
            aria-hidden="true"
            className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
          {busyLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}
