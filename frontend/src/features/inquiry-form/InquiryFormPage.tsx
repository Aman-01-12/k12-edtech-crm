import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import {
  HONEYPOT_FIELD,
  INQUIRY_CATEGORIES,
  INQUIRY_CATEGORY_LABELS,
  MESSAGE_MAX_LENGTH,
  USER_TYPES,
  USER_TYPE_LABELS,
  createInquirySchema,
  type CreateInquiryInput,
} from '@k12/contracts';
import { Link } from 'react-router';
import { ApiRequestError, api } from '../../lib/api-client';
import { Button } from '../../components/Button';
import { Field, controlClass, selectClass, selectStyle } from '../../components/Field';

/**
 * The public inquiry form.
 *
 * Validates with the same schema the server enforces, so the feedback a visitor
 * sees while typing is the rule that will actually be applied.
 */

type Phase = { kind: 'editing' } | { kind: 'submitted' } | { kind: 'failed'; message: string };

/**
 * A key per submission attempt, kept across retries of that attempt so a
 * timeout followed by a retry produces one inquiry rather than two.
 */
function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function InquiryFormPage() {
  const [phase, setPhase] = useState<Phase>({ kind: 'editing' });
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    setFocus,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateInquiryInput>({
    resolver: standardSchemaResolver(createInquirySchema),
    mode: 'onBlur',
    // The two selects are deliberately absent rather than set to undefined:
    // exactOptionalPropertyTypes treats those as different, and an unselected
    // enum has no valid default value to give it.
    defaultValues: { fullName: '', email: '', phone: '', message: '' },
  });

  const messageLength = watch('message')?.length ?? 0;
  // Registered once and reused rather than inline in the JSX, so the digit
  // filter below can call the real onChange react-hook-form gave this field
  // instead of a second, unrelated one.
  const phoneField = register('phone');

  const onSubmit = handleSubmit(
    async (values) => {
      try {
        await api.post('/inquiries', values, { 'X-Idempotency-Key': idempotencyKey });
        setPhase({ kind: 'submitted' });
        reset();
        // A fresh key, so the next inquiry is a new one rather than a replay.
        setIdempotencyKey(newIdempotencyKey());
      } catch (error) {
        if (error instanceof ApiRequestError) {
          // Attach server field errors to their fields, so a rule the client
          // did not enforce still lands next to the input that caused it.
          const fieldErrors = error.fieldErrors();
          let attached = false;
          for (const [field, messages] of Object.entries(fieldErrors)) {
            if (field !== '_' && messages[0] !== undefined) {
              setError(field as keyof CreateInquiryInput, { message: messages[0] });
              attached = true;
            }
          }
          setPhase(attached ? { kind: 'editing' } : { kind: 'failed', message: error.message });
          return;
        }
        setPhase({ kind: 'failed', message: 'Something went wrong. Please try again.' });
      }
    },
    (invalid) => {
      // Focus the first field that failed, so a keyboard or screen-reader user
      // is taken to the problem instead of having to hunt for it.
      const first = Object.keys(invalid)[0];
      if (first !== undefined) {
        setFocus(first as keyof CreateInquiryInput);
      }
    },
  );

  return (
    <div className="relative min-h-screen lg:flex">
      {/* Below lg, the image is a quiet backdrop behind a centred column: there
          is no room for a second column on a phone, and the task (filling the
          form) needs the width. At lg and up it becomes a dedicated right-hand
          panel instead (below), because a split layout only reads as
          deliberate once there is enough width for both halves to breathe. */}
      <div aria-hidden="true" className="fixed inset-0 overflow-hidden lg:hidden">
        <img
          src="/images/marigold-bg.webp"
          alt=""
          className="absolute top-0 right-0 h-full w-full scale-110 object-cover object-[62%_45%] sm:w-3/5"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-canvas via-canvas/85 to-canvas/25 sm:to-canvas/10" />
        <div className="absolute inset-0 bg-gradient-to-b from-canvas/5 via-transparent to-canvas" />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-xl px-5 py-6 sm:py-10 lg:mx-0 lg:flex lg:max-w-none lg:flex-1 lg:items-center lg:justify-center lg:px-10 lg:py-16">
        <div className="w-full lg:max-w-2xl">
          <div className="flex items-center justify-between">
            <p className="font-display text-sm font-semibold tracking-[0.18em] text-marigold-deep uppercase">
              K12 Hunar
            </p>
            <Link
              to="/admin/login"
              className="text-sm font-medium text-ink-muted underline-offset-2 hover:text-marigold-deep hover:underline"
            >
              Staff sign in
            </Link>
          </div>

          {phase.kind === 'submitted' ? (
            <div
              className="mt-10 rounded-card border border-sage bg-sage-wash p-8 text-center shadow-sm sm:mt-16"
              role="status"
              aria-live="polite"
            >
              <h1 className="font-display text-2xl font-bold text-ink">Enquiry sent</h1>
              <p className="mt-3 text-ink-muted">
                Thank you. The K12 Hunar team has your enquiry and will be in touch on the phone
                number or email you gave us.
              </p>
              <div className="mt-6 flex justify-center">
                <Button onClick={() => setPhase({ kind: 'editing' })}>Send another enquiry</Button>
              </div>
            </div>
          ) : (
            <div className="mt-6 rounded-card border border-edge bg-surface/95 p-6 shadow-sm backdrop-blur-sm sm:mt-10 sm:p-9">
              <header>
                <h1 className="font-display text-3xl font-bold text-ink sm:text-4xl">
                  Tell us what you need
                </h1>
                <p className="mt-3 text-ink-muted">
                  Scholarships, admissions, concerts, or anything else. Fill this in and the team
                  will get back to you.
                </p>
              </header>

              {phase.kind === 'failed' ? (
                <div
                  role="alert"
                  className="mt-6 rounded-lg border border-clay bg-clay-wash px-4 py-3 text-sm font-medium text-clay"
                >
                  {phase.message}
                </div>
              ) : null}

              <form
                onSubmit={(event) => void onSubmit(event)}
                noValidate
                className="mt-8 flex flex-col gap-5"
              >
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="I am a" error={errors.userType?.message} required>
                    {(a11y) => (
                      <select
                        {...a11y}
                        {...register('userType')}
                        className={selectClass}
                        style={selectStyle}
                        defaultValue=""
                      >
                        <option value="" disabled>
                          Select one
                        </option>
                        {USER_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {USER_TYPE_LABELS[type]}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>

                  <Field label="This is about" error={errors.category?.message} required>
                    {(a11y) => (
                      <select
                        {...a11y}
                        {...register('category')}
                        className={selectClass}
                        style={selectStyle}
                        defaultValue=""
                      >
                        <option value="" disabled>
                          Select one
                        </option>
                        {INQUIRY_CATEGORIES.map((category) => (
                          <option key={category} value={category}>
                            {INQUIRY_CATEGORY_LABELS[category]}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                </div>

                <Field label="Full name" error={errors.fullName?.message} required>
                  {(a11y) => (
                    <input
                      {...a11y}
                      {...register('fullName')}
                      type="text"
                      autoComplete="name"
                      placeholder="Priya Sharma"
                      className={controlClass}
                    />
                  )}
                </Field>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Email" error={errors.email?.message} required>
                    {(a11y) => (
                      <input
                        {...a11y}
                        {...register('email')}
                        type="email"
                        autoComplete="email"
                        placeholder="priya@example.com"
                        className={controlClass}
                      />
                    )}
                  </Field>

                  <Field
                    label="Phone number"
                    error={errors.phone?.message}
                    hint="10-digit Indian mobile number"
                    required
                  >
                    {(a11y) => (
                      <input
                        {...a11y}
                        {...phoneField}
                        type="tel"
                        inputMode="numeric"
                        autoComplete="tel"
                        placeholder="9876543210"
                        className={controlClass}
                        onChange={(event) => {
                          // Only digits count, and only the first ten of them.
                          // Deliberately not a maxLength attribute: that caps
                          // raw characters typed, including the symbols this
                          // filter is about to strip, so pasting a number
                          // written as "+91 98765 43210" would be cut down to
                          // "+91 98765 4" before the digits inside it were
                          // ever counted.
                          event.target.value = event.target.value.replace(/\D/g, '').slice(0, 10);
                          void phoneField.onChange(event);
                        }}
                      />
                    )}
                  </Field>
                </div>

                <Field
                  label="Your question"
                  error={errors.message?.message}
                  hint={`${messageLength} of ${MESSAGE_MAX_LENGTH} characters`}
                  required
                >
                  {(a11y) => (
                    <textarea
                      {...a11y}
                      {...register('message')}
                      rows={5}
                      placeholder="Tell us what you would like to know."
                      className={`${controlClass} resize-y`}
                    />
                  )}
                </Field>

                {/*
          Honeypot. Positioned off-screen rather than display:none, because some
          bots skip hidden fields; aria-hidden and tabIndex -1 keep it away from
          screen-reader and keyboard users. See middleware/honeypot.ts.
        */}
                <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
                  <label htmlFor={HONEYPOT_FIELD}>Website</label>
                  <input
                    id={HONEYPOT_FIELD}
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    {...register(HONEYPOT_FIELD)}
                  />
                </div>

                {/* Stacked on a phone: side by side, the helper text squeezed the
            button until its label wrapped onto two lines. */}
                <div className="mt-2 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-4">
                  <Button type="submit" variant="primary" busy={isSubmitting} busyLabel="Sending">
                    Send enquiry
                  </Button>
                  <p className="text-xs text-ink-faint">
                    We only use these details to reply to you.
                  </p>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* The lg+ panel. A plain image fill rather than the gradient-washed
          treatment above: once it owns a whole column it is the supporting
          half of a two-part composition, not a backdrop peeking out from
          behind the task. Gutenberg's reading-gravity diagram puts the
          primary optical area top-left and the terminal area bottom-right;
          the form, the thing a visitor is here to do, keeps the left column
          it already had below lg, and the image takes the secondary right
          column rather than competing for the same corner. Only a narrow
          seam blend ties the two together. */}
      <aside
        aria-hidden="true"
        className="relative hidden overflow-hidden lg:block lg:w-[38%] lg:shrink-0"
      >
        <img
          src="/images/marigold-bg.webp"
          alt=""
          className="absolute inset-0 h-full w-full object-cover object-[58%_42%]"
        />
        <div className="absolute inset-y-0 left-0 w-28 bg-gradient-to-r from-canvas to-transparent" />
      </aside>
    </div>
  );
}
