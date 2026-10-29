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

      {/* Always rendered, even with nothing to say, so two fields side by side
          in a grid row start their input boxes at the same height whether or
          not one of them happens to have a hint. Without this, a field with a
          hint pushes its input down while its neighbour's does not, and the
          two boxes end up at different heights for no reason a user can see. */}
      <p
        id={hint === undefined ? undefined : hintId}
        aria-hidden={hint === undefined ? true : undefined}
        className="min-h-[1.125rem] text-xs text-ink-muted"
      >
        {hint ?? '\u00A0'}
      </p>

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

/**
 * A `<select>` drawn with this project's own chevron and borders instead of
 * the browser's native control chrome, which otherwise looks unstyled next to
 * every other field. `appearance-none` removes the native arrow; the chevron
 * below replaces it as a background image rather than a child element, so the
 * control is still exactly one native `<select>` and keeps the keyboard and
 * screen-reader behaviour that a custom listbox would have to re-implement.
 */
const SELECT_CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8' fill='none'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%234A6673' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")";

export const selectClass =
  `${CONTROL_CLASS} appearance-none bg-no-repeat pr-10 ` +
  'bg-[length:12px_8px] bg-[position:right_1rem_center] cursor-pointer';

export const selectStyle = { backgroundImage: SELECT_CHEVRON };
