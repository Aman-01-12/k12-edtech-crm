import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { Link } from 'react-router';
import { forgotPasswordSchema, type ForgotPassword } from '@k12/contracts';
import { api } from '../../lib/api-client';
import { Button } from '../../components/Button';
import { Field, controlClass } from '../../components/Field';
import { AuthCard } from './AuthCard';

/**
 * Requesting a reset link.
 *
 * The confirmation is deliberately the same whether or not the address has an
 * account, and the request is treated as having succeeded even if it did not,
 * so this screen cannot be used to discover which addresses are registered.
 */
export function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false);

  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPassword>({
    resolver: standardSchemaResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit(
    async (values) => {
      // No catch that changes the outcome: a failure here must look the same as
      // a success, or the UI reintroduces the oracle the API avoids.
      await api.post('/auth/forgot-password', values).catch(() => undefined);
      setSubmitted(true);
    },
    (invalid) => {
      if (Object.keys(invalid)[0] !== undefined) {
        setFocus('email');
      }
    },
  );

  if (submitted) {
    return (
      <AuthCard title="Check your email">
        <p className="mt-3 text-sm text-ink-muted" role="status" aria-live="polite">
          If that address has a staff account, a reset link is on its way. The link works once and
          expires within the hour.
        </p>
        <p className="mt-6 text-sm">
          <Link to="/admin/login" className="font-medium text-marigold-deep underline">
            Back to sign in
          </Link>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Reset your password">
      <p className="mt-2 text-sm text-ink-muted">
        Enter the email address on your staff account and we will send you a link to choose a new
        password.
      </p>

      <form
        onSubmit={(event) => void onSubmit(event)}
        noValidate
        className="mt-6 flex flex-col gap-5"
      >
        <Field label="Email" error={errors.email?.message} required>
          {(a11y) => (
            <input
              {...a11y}
              {...register('email')}
              type="email"
              autoComplete="username"
              className={controlClass}
            />
          )}
        </Field>

        <Button type="submit" variant="primary" busy={isSubmitting} busyLabel="Sending">
          Send reset link
        </Button>
      </form>

      <p className="mt-6 text-sm">
        <Link to="/admin/login" className="font-medium text-marigold-deep underline">
          Back to sign in
        </Link>
      </p>
    </AuthCard>
  );
}
