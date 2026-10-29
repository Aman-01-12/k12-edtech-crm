import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useLocation, useNavigate, type Location } from 'react-router';
import { loginSchema, type AuthenticatedAdmin, type LoginInput } from '@k12/contracts';
import { ApiRequestError, api } from '../../lib/api-client';
import { Button } from '../../components/Button';
import { Field, controlClass } from '../../components/Field';
import { useSession } from './session';

interface RedirectState {
  from?: string;
}

export function LoginPage() {
  const { signIn } = useSession();
  const navigate = useNavigate();
  const location = useLocation() as Location<RedirectState | null>;
  const [failure, setFailure] = useState<string | undefined>();

  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: standardSchemaResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(
    async (values) => {
      setFailure(undefined);
      try {
        const result = await api.post<{ admin: AuthenticatedAdmin }>('/auth/login', values);
        signIn(result.admin);
        // Return the user to whatever they originally asked for.
        await navigate(location.state?.from ?? '/admin/inquiries', { replace: true });
      } catch (error) {
        setFailure(
          error instanceof ApiRequestError ? error.message : 'Could not sign in. Please try again.',
        );
      }
    },
    (invalid) => {
      const first = Object.keys(invalid)[0];
      if (first !== undefined) {
        setFocus(first as keyof LoginInput);
      }
    },
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-12">
      <div className="rounded-card border border-edge bg-surface p-7 shadow-sm">
        <p className="font-display text-xs font-semibold tracking-[0.18em] text-marigold-deep uppercase">
          K12 Hunar
        </p>
        <h1 className="mt-2 font-display text-2xl font-bold text-ink">Staff sign in</h1>
        <p className="mt-2 text-sm text-ink-muted">
          This dashboard is for K12 Hunar staff. If you meant to send an enquiry,{' '}
          <a href="/" className="font-medium text-marigold-deep underline">
            use the enquiry form
          </a>
          .
        </p>

        {failure === undefined ? null : (
          <div
            role="alert"
            className="mt-5 rounded-lg border border-clay bg-clay-wash px-4 py-3 text-sm font-medium text-clay"
          >
            {failure}
          </div>
        )}

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

          <Field label="Password" error={errors.password?.message} required>
            {(a11y) => (
              <input
                {...a11y}
                {...register('password')}
                type="password"
                autoComplete="current-password"
                className={controlClass}
              />
            )}
          </Field>

          <Button type="submit" variant="primary" busy={isSubmitting} busyLabel="Signing in">
            Sign in
          </Button>
        </form>
      </div>
    </main>
  );
}
