import { INQUIRY_STATUSES, INQUIRY_STATUS_LABELS, type InquiryStatus } from '@k12/contracts';

/**
 * The signature element from ADR 0009.
 *
 * Status is genuinely a sequence, so it renders as a connected rail rather than
 * a dropdown: how far an enquiry has travelled is visible without reading, and
 * advancing it is clicking forward along the rail.
 *
 * A radiogroup, because that is what it behaves like: arrow keys move between
 * steps and the current value is announced.
 */
interface StatusRailProps {
  value: InquiryStatus;
  onChange: (status: InquiryStatus) => void;
  disabled?: boolean;
  /** Names the enquiry this rail belongs to, for screen readers. */
  describedFor: string;
  /**
   * Label every step rather than only the current one.
   *
   * On in the record panel, where there is room and a staff member is deciding
   * what to do next. Off in the table, where spelling out four statuses on
   * every row made the column wide enough to need horizontal scrolling and hid
   * the control the design is built around.
   */
  showAllLabels?: boolean;
}

const CURRENT_TONE: Record<InquiryStatus, string> = {
  new: 'border-marigold bg-marigold-wash text-marigold-deep',
  in_progress: 'border-marigold bg-marigold-wash text-marigold-deep',
  resolved: 'border-sage bg-sage-wash text-sage',
  closed: 'border-ink-faint bg-canvas text-ink-muted',
};

/** What each step means, so the rail does not assume the reader knows. */
const MEANING: Record<InquiryStatus, string> = {
  new: 'nobody has picked this up yet',
  in_progress: 'someone is working on it',
  resolved: 'the enquiry has been answered',
  closed: 'finished, no further action',
};

export function StatusRail({
  value,
  onChange,
  disabled = false,
  describedFor,
  showAllLabels = false,
}: StatusRailProps) {
  const currentIndex = INQUIRY_STATUSES.indexOf(value);

  return (
    <div
      role="radiogroup"
      aria-label={`Status for ${describedFor}`}
      className={`inline-flex ${showAllLabels ? 'items-start gap-1.5' : 'items-center gap-1'}`}
    >
      {INQUIRY_STATUSES.map((status, index) => {
        const isCurrent = status === value;
        const isReached = index <= currentIndex;
        const label = INQUIRY_STATUS_LABELS[status];

        // Says what the step is and what clicking does, because a bare circle
        // tells a new admin nothing.
        const hint = isCurrent
          ? `${label} - ${MEANING[status]}. This is the current status.`
          : `Mark as ${label} - ${MEANING[status]}.`;

        return (
          <div
            key={status}
            className={showAllLabels ? 'flex items-center gap-1.5' : 'flex items-center gap-1'}
          >
            {index > 0 ? (
              <span
                aria-hidden="true"
                className={`h-px ${showAllLabels ? 'w-3' : 'w-2.5'} ${
                  isReached ? 'bg-marigold' : 'bg-edge'
                }`}
              />
            ) : null}

            {showAllLabels ? (
              <button
                type="button"
                role="radio"
                aria-checked={isCurrent}
                aria-label={label}
                title={hint}
                disabled={disabled}
                onClick={() => {
                  if (!isCurrent) {
                    onChange(status);
                  }
                }}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  isCurrent
                    ? CURRENT_TONE[status]
                    : 'border-edge bg-surface text-ink-muted hover:border-marigold hover:bg-marigold-wash hover:text-marigold-deep'
                }`}
              >
                {label}
              </button>
            ) : (
              <button
                type="button"
                role="radio"
                aria-checked={isCurrent}
                aria-label={label}
                title={hint}
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
            )}
          </div>
        );
      })}
    </div>
  );
}
