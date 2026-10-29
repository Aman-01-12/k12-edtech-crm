import { useId, type ReactNode } from 'react';

/**
 * A labelled form control with its error wired up for assistive technology.
 *
 * The label, the control and the error message are connected through generated
 * ids here rather than at each call site, because that wiring is what makes a
 * screen reader announce "Email, invalid, enter a valid email address" instead
 * of just "edit text".
 */
interface FieldProps {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  required?: boolean;
  children: (props: {
    id: string;
    'aria-describedby': string | undefined;
    'aria-invalid': boolean | undefined;
    'aria-required': boolean | undefined;
  }) => ReactNode;
}

export function Field({ label, error, hint, required = false, children }: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  const describedBy = [hint === undefined ? null : hintId, error === undefined ? null : errorId]
    .filter((value): value is string => value !== null)
    .join(' ');

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
        {required ? (
          <span className="ml-1 text-clay" aria-hidden="true">
            *
          </span>
        ) : null}
        {required ? <span className="sr-only"> (required)</span> : null}
      </label>

      {hint === undefined ? null : (
        <p id={hintId} className="text-xs text-ink-muted">
          {hint}
        </p>
      )}

      {children({
        id,
        'aria-describedby': describedBy.length > 0 ? describedBy : undefined,
        'aria-invalid': error === undefined ? undefined : true,
        'aria-required': required ? true : undefined,
      })}

      {/* role=alert so the message is announced when it appears, not only when
          the field is next focused. */}
      {error === undefined ? null : (
        <p id={errorId} role="alert" className="text-sm font-medium text-clay">
          {error}
        </p>
      )}
    </div>
  );
}

const CONTROL_CLASS =
  'w-full rounded-lg border border-edge bg-surface px-3 py-2.5 text-ink ' +
  'placeholder:text-ink-faint transition-colors ' +
  'hover:border-ink-faint aria-invalid:border-clay aria-invalid:bg-clay-wash';

export const controlClass = CONTROL_CLASS;
