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
import { ApiRequestError } from '../../lib/api-client';
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
  const { detail, addNote, deleteNote, assign, reply } = useInquiryDetail(inquiryId);
  const [noteBody, setNoteBody] = useState('');
  const [composing, setComposing] = useState(false);
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
                  showAllLabels
                />
                <p className="mt-2 text-xs text-ink-faint">
                  Click a stage to move this enquiry to it.
                </p>
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
                  <button
                    type="button"
                    onClick={() => setComposing((open) => !open)}
                    aria-expanded={composing}
                    className="inline-flex items-center rounded-lg border border-edge px-3 py-2 text-sm font-semibold hover:border-ink-faint"
                  >
                    {composing ? 'Cancel reply' : 'Reply by email'}
                  </button>
                </div>

                {composing ? (
                  <ReplyComposer
                    defaultSubject={`Re: your ${INQUIRY_CATEGORY_LABELS[
                      inquiry.category
                    ].toLowerCase()} enquiry`}
                    recipient={inquiry.email}
                    busy={reply.isPending}
                    error={reply.error instanceof ApiRequestError ? reply.error.message : undefined}
                    onSend={(input) =>
                      reply.mutate(input, {
                        onSuccess: () => {
                          setComposing(false);
                          reply.reset();
                        },
                      })
                    }
                  />
                ) : null}
              </Section>

              <Section label="Their message">
                {/* Rendered as text, never as markup. React escapes it, which is
                    what makes a submitted <script> tag inert here. */}
                <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink">
                  {inquiry.message}
                </p>
              </Section>

              <Section label="Notes and replies">
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
                    <li
                      key={note.id}
                      className={`border-l-2 pl-3 ${
                        note.kind === 'reply' ? 'border-sage' : 'border-marigold/40'
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-xs font-semibold text-ink">
                          {note.authorName}
                          {note.kind === 'reply' ? (
                            <span className="ml-2 rounded-full border border-sage bg-sage-wash px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-sage uppercase">
                              Emailed
                            </span>
                          ) : null}
                        </p>
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
                      {note.subject === null ? null : (
                        <p className="mt-1 text-xs font-medium text-ink">{note.subject}</p>
                      )}
                      <p className="mt-1 text-sm whitespace-pre-wrap text-ink-muted">{note.body}</p>
                    </li>
                  ))}
                  {(detail.data?.notes.length ?? 0) === 0 && !detail.isLoading ? (
                    <li className="text-sm text-ink-faint">Nothing recorded yet.</li>
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

/**
 * The reply composer.
 *
 * Collects only a subject and a message. The recipient is shown but not
 * editable, because the server reads it from the enquiry and would ignore
 * anything sent here anyway.
 */
function ReplyComposer({
  defaultSubject,
  recipient,
  busy,
  error,
  onSend,
}: {
  defaultSubject: string;
  recipient: string;
  busy: boolean;
  error: string | undefined;
  onSend: (input: { subject: string; body: string }) => void;
}) {
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState('');
  const canSend = subject.trim().length > 0 && body.trim().length > 0;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) {
          onSend({ subject: subject.trim(), body: body.trim() });
        }
      }}
      className="mt-4 flex flex-col gap-3 border-t border-edge pt-4"
    >
      <p className="text-xs text-ink-muted">
        Sending to <span className="font-medium text-ink">{recipient}</span>. Their reply comes back
        to your own address.
      </p>

      {error === undefined ? null : (
        <p role="alert" className="text-sm font-medium text-clay">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="reply-subject" className="text-xs font-medium text-ink">
          Subject
        </label>
        <input
          id="reply-subject"
          type="text"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          className="w-full rounded-lg border border-edge bg-surface px-3 py-2 text-sm"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="reply-body" className="text-xs font-medium text-ink">
          Message
        </label>
        <textarea
          id="reply-body"
          rows={6}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Thank you for getting in touch..."
          className="w-full resize-y rounded-lg border border-edge bg-surface px-3 py-2 text-sm placeholder:text-ink-faint"
        />
      </div>

      <div>
        <Button type="submit" variant="primary" busy={busy} busyLabel="Sending" disabled={!canSend}>
          Send email
        </Button>
      </div>
    </form>
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
