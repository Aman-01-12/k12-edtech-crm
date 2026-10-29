import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { newPasswordSchema, type AuthenticatedAdmin } from '@k12/contracts';
import { z } from 'zod';
import { ApiRequestError, api } from '../../lib/api-client';
import { Button } from '../../components/Button';
import { Field, controlClass } from '../../components/Field';
import { AuthCard } from './AuthCard';
import { useSession } from './session';

/**
 * The token comes from the URL, so the form itself only collects the password.
 * Confirming it twice is a client-side concern: the server has no use for the
 * second copy, so it is checked here and never sent.
 */
const formSchema = z
  .object({
    newPassword: newPasswordSchema,
    confirmPassword: z.string().min(1, 'Re-enter the new password.'),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: 'The two passwords do not match.',
    path: ['confirmPassword'],
  });

type FormValues = z.input<typeof formSchema>;

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const { signIn } = useSession();
  const navigate = useNavigate();
  const [failure, setFailure] = useState<string | undefined>();

  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: standardSchemaResolver(formSchema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(
    async (values) => {
      setFailure(undefined);
      try {
        const result = await api.post<{ admin: AuthenticatedAdmin }>('/auth/reset-password', {
          token,
          newPassword: values.newPassword,
        });
        // The reset issues a session, so the user lands in the dashboard rather
        // than being asked to type the password they just chose.
        signIn(result.admin);
        await navigate('/admin/inquiries', { replace: true });
      } catch (error) {
        setFailure(
          error instanceof ApiRequestError
            ? error.message
            : 'Could not reset your password. Please try again.',
        );
      }
    },
    (invalid) => {
      const first = Object.keys(invalid)[0];
      if (first !== undefined) {
        setFocus(first as keyof FormValues);
      }
    },
  );

  if (token === '') {
    return (
      <AuthCard title="This link is incomplete">
        <p className="mt-3 text-sm text-ink-muted">
          The reset link is missing its token. Request a new one and open the most recent email.
        </p>
        <p className="mt-6 text-sm">
          <Link to="/admin/forgot-password" className="font-medium text-marigold-deep underline">
            Request a new link
          </Link>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password">
      <p className="mt-2 text-sm text-ink-muted">
        At least 12 characters, with an uppercase letter, a lowercase letter and a digit.
      </p>

      {failure === undefined ? null : (
        <div
          role="alert"
          className="mt-5 rounded-lg border border-clay bg-clay-wash px-4 py-3 text-sm font-medium text-clay"
        >
          {failure}{' '}
          <Link to="/admin/forgot-password" className="underline">
            Request a new link
          </Link>
          .
        </div>
      )}

      <form
        onSubmit={(event) => void onSubmit(event)}
        noValidate
        className="mt-6 flex flex-col gap-5"
      >
        <Field label="New password" error={errors.newPassword?.message} required>
          {(a11y) => (
            <input
              {...a11y}
              {...register('newPassword')}
              type="password"
              autoComplete="new-password"
              className={controlClass}
            />
          )}
        </Field>

        <Field label="Confirm new password" error={errors.confirmPassword?.message} required>
          {(a11y) => (
            <input
              {...a11y}
              {...register('confirmPassword')}
              type="password"
              autoComplete="new-password"
              className={controlClass}
            />
          )}
        </Field>

        <Button type="submit" variant="primary" busy={isSubmitting} busyLabel="Saving">
          Set new password
        </Button>
      </form>
    </AuthCard>
  );
}
