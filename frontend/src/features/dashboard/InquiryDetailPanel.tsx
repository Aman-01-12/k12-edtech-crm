import { useEffect, useRef, useState } from 'react';
import {
  INQUIRY_CATEGORY_LABELS,
  USER_TYPE_LABELS,
  type AdminSummary,
  type Inquiry,
  type InquiryStatus,
} from '@k12/contracts';
import { Button } from '../../components/Button';
import { selectClass, selectStyle } from '../../components/Field';
import { StatusRail } from '../../components/StatusRail';
import { useInquiryDetail } from './useInquiryDetail';

/**
 * The enquiry record, as a slide-over rather than a page.
 *
 * A panel keeps the list behind it, which is how a staff member works through a
 * queue: open, read, act, close, next. A route change would lose the scroll
 * position and the filters every time.
 */
interface InquiryDetailPanelProps {
  inquiryId: string;
  /** The row already in the table, shown while the full record loads. */
  fallback: Inquiry | undefined;
  admins: AdminSummary[];
  onClose: () => void;
  onChangeStatus: (status: InquiryStatus) => void;
}

const TIMESTAMP = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function InquiryDetailPanel({
  inquiryId,
  fallback,
  admins,
  onClose,
  onChangeStatus,
}: InquiryDetailPanelProps) {
  const { detail, addNote, deleteNote, assign } = useInquiryDetail(inquiryId);
  const [noteBody, setNoteBody] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const inquiry = detail.data?.inquiry ?? fallback;

  // Escape closes, and focus starts inside the panel, which is the minimum a
  // dialog owes a keyboard user.
  useEffect(() => {
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/* Clicking away closes, which is the expected gesture for a slide-over. */}
      <button
        type="button"
        aria-label="Close enquiry"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ink/25"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Enquiry from ${inquiry?.fullName ?? 'loading'}`}
        className="relative flex h-full w-full max-w-xl flex-col border-l border-edge bg-surface shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-edge px-6 py-5">
          <div className="min-w-0">
            <h2 className="font-display text-xl font-bold text-ink">
              {inquiry?.fullName ?? 'Loading'}
            </h2>
            {inquiry === undefined ? null : (
              <p className="mt-1 text-sm text-ink-muted">
                {USER_TYPE_LABELS[inquiry.userType]} &middot;{' '}
                {INQUIRY_CATEGORY_LABELS[inquiry.category]} &middot;{' '}
                {TIMESTAMP.format(new Date(inquiry.createdAt))}
              </p>
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="-mr-2 rounded-lg px-3 py-1.5 text-sm font-medium text-ink-muted hover:bg-canvas hover:text-ink"
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {inquiry === undefined ? (
            <p className="px-6 py-10 text-center text-ink-muted">Loading enquiry...</p>
          ) : (
            <>
              <Section label="Status">
                <StatusRail
                  value={inquiry.status}
                  describedFor={inquiry.fullName}
                  onChange={onChangeStatus}
                />
              </Section>

              <Section label="Owner">
                <select
                  value={inquiry.assignedToAdminId ?? ''}
                  disabled={assign.isPending}
                  onChange={(event) =>
                    assign.mutate(event.target.value === '' ? null : event.target.value)
                  }
                  className={`${selectClass} max-w-xs`}
                  style={selectStyle}
                  aria-label="Assign this enquiry"
                >
                  <option value="">Unassigned</option>
                  {admins.map((admin) => (
                    <option key={admin.id} value={admin.id}>
                      {admin.fullName}
                    </option>
                  ))}
                </select>
              </Section>

              <Section label="Contact">
                <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
                  <dt className="text-ink-muted">Phone</dt>
                  <dd>
                    <a href={`tel:${inquiry.phone}`} className="font-medium hover:underline">
                      {inquiry.phone}
                    </a>
                  </dd>
                  <dt className="text-ink-muted">Email</dt>
                  <dd className="min-w-0">
                    <a
                      href={`mailto:${inquiry.email}`}
                      className="font-medium break-all hover:underline"
                    >
                      {inquiry.email}
                    </a>
                  </dd>
                </dl>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a
                    href={`tel:${inquiry.phone}`}
                    className="inline-flex items-center rounded-lg border border-edge px-3 py-2 text-sm font-semibold hover:border-ink-faint"
                  >
                    Call
                  </a>
                  <a
                    href={`mailto:${inquiry.email}?subject=${encodeURIComponent(
                      `Your ${INQUIRY_CATEGORY_LABELS[inquiry.category]} enquiry`,
                    )}`}
                    className="inline-flex items-center rounded-lg border border-edge px-3 py-2 text-sm font-semibold hover:border-ink-faint"
                  >
                    Reply by email
                  </a>
                </div>
              </Section>

              <Section label="Their message">
                {/* Rendered as text, never as markup. React escapes it, which is
                    what makes a submitted <script> tag inert here. */}
                <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink">
                  {inquiry.message}
                </p>
              </Section>

              <Section label="Internal notes">
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const body = noteBody.trim();
                    if (body.length > 0) {
                      addNote.mutate(body, { onSuccess: () => setNoteBody('') });
                    }
                  }}
                  className="flex flex-col gap-2"
                >
                  <label htmlFor="note-body" className="sr-only">
                    Add an internal note
                  </label>
                  <textarea
                    id="note-body"
                    rows={3}
                    value={noteBody}
                    onChange={(event) => setNoteBody(event.target.value)}
                    placeholder="Rang them, call back Tuesday..."
                    className="w-full resize-y rounded-lg border border-edge bg-surface px-3 py-2 text-sm placeholder:text-ink-faint"
                  />
                  <div className="flex items-center gap-3">
                    <Button
                      type="submit"
                      variant="primary"
                      busy={addNote.isPending}
                      busyLabel="Saving"
                      disabled={noteBody.trim().length === 0}
                    >
                      Add note
                    </Button>
                    <span className="text-xs text-ink-faint">Only staff can see these.</span>
                  </div>
                </form>

                <ul className="mt-5 flex flex-col gap-4">
                  {(detail.data?.notes ?? []).map((note) => (
                    <li key={note.id} className="border-l-2 border-marigold/40 pl-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-xs font-semibold text-ink">{note.authorName}</p>
                        <div className="flex items-center gap-2">
                          <time className="text-xs text-ink-faint">
                            {TIMESTAMP.format(new Date(note.createdAt))}
                          </time>
                          {note.deletableByViewer ? (
                            <button
                              type="button"
                              onClick={() => deleteNote.mutate(note.id)}
                              className="text-xs font-medium text-clay hover:underline"
                            >
                              Delete
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <p className="mt-1 text-sm whitespace-pre-wrap text-ink-muted">{note.body}</p>
                    </li>
                  ))}
                  {(detail.data?.notes.length ?? 0) === 0 && !detail.isLoading ? (
                    <li className="text-sm text-ink-faint">No notes yet.</li>
                  ) : null}
                </ul>
              </Section>

              <Section label="History" last>
                <ol className="flex flex-col gap-3">
                  {(detail.data?.timeline ?? []).map((entry) => (
                    <li key={entry.id} className="flex gap-3 text-sm">
                      <span
                        aria-hidden="true"
                        className="mt-1.5 size-1.5 shrink-0 rounded-full bg-ink-faint"
                      />
                      <div>
                        <p className="text-ink">{entry.summary}</p>
                        <p className="text-xs text-ink-faint">
                          {entry.actorName ?? 'A former colleague'} &middot;{' '}
                          {TIMESTAMP.format(new Date(entry.createdAt))}
                        </p>
                      </div>
                    </li>
                  ))}
                  {(detail.data?.timeline.length ?? 0) === 0 && !detail.isLoading ? (
                    <li className="text-sm text-ink-faint">
                      Nothing has happened to this enquiry yet.
                    </li>
                  ) : null}
                </ol>
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** A labelled band. Hairline rules instead of nested cards, per ADR 0014. */
function Section({
  label,
  children,
  last = false,
}: {
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <section className={`px-6 py-5 ${last ? '' : 'border-b border-edge'}`}>
      <h3 className="mb-3 text-xs font-semibold tracking-[0.12em] text-ink-faint uppercase">
        {label}
      </h3>
      {children}
    </section>
  );
}
