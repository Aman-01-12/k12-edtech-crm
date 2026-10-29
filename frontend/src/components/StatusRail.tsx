import { INQUIRY_STATUSES, INQUIRY_STATUS_LABELS, type InquiryStatus } from '@k12/contracts';

/**
 * The signature element from ADR 0009.
 *
 * Status is genuinely a sequence, so it renders as a connected rail rather than
 * a dropdown: how far an inquiry has travelled is visible without reading, and
 * advancing it is clicking forward along the rail.
 *
 * Only the current step carries its label. Spelling out all four on every row
 * repeated the same words twenty times down the page and made the column wide
 * enough to need horizontal scrolling, which hid the control the design is
 * built around. The other steps stay as nodes, each with an accessible name.
 *
 * A radiogroup, because that is what it behaves like: arrow keys move between
 * steps and the current value is announced.
 */
interface StatusRailProps {
  value: InquiryStatus;
  onChange: (status: InquiryStatus) => void;
  disabled?: boolean;
  /** Names the inquiry this rail belongs to, for screen readers. */
  describedFor: string;
}

const CURRENT_TONE: Record<InquiryStatus, string> = {
  new: 'border-marigold bg-marigold-wash text-marigold-deep',
  in_progress: 'border-marigold bg-marigold-wash text-marigold-deep',
  resolved: 'border-sage bg-sage-wash text-sage',
  closed: 'border-ink-faint bg-canvas text-ink-muted',
};

export function StatusRail({ value, onChange, disabled = false, describedFor }: StatusRailProps) {
  const currentIndex = INQUIRY_STATUSES.indexOf(value);

  return (
    <div
      role="radiogroup"
      aria-label={`Status for ${describedFor}`}
      className="inline-flex items-center gap-1"
    >
      {INQUIRY_STATUSES.map((status, index) => {
        const isCurrent = status === value;
        const isReached = index <= currentIndex;
        const label = INQUIRY_STATUS_LABELS[status];

        return (
          <div key={status} className="flex items-center gap-1">
            {index > 0 ? (
              <span
                aria-hidden="true"
                className={`h-px w-2.5 ${isReached ? 'bg-marigold' : 'bg-edge'}`}
              />
            ) : null}

            <button
              type="button"
              role="radio"
              aria-checked={isCurrent}
              aria-label={label}
              title={isCurrent ? label : `Mark as ${label}`}
              disabled={disabled}
              onClick={() => {
                if (!isCurrent) {
                  onChange(status);
                }
              }}
              className={
                isCurrent
                  ? `rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${CURRENT_TONE[status]}`
                  : `size-4 rounded-full border transition-colors hover:border-marigold hover:bg-marigold-wash disabled:cursor-not-allowed disabled:opacity-50 ${
                      isReached ? 'border-marigold/60 bg-marigold/20' : 'border-edge bg-surface'
                    }`
              }
            >
              {isCurrent ? label : null}
            </button>
          </div>
        );
      })}
    </div>
  );
}
