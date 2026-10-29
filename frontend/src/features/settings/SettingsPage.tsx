import { useState } from 'react';
import { Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  changePasswordSchema,
  createAdminSchema,
  type AdminSummary,
  type ChangePassword,
  type CreateAdmin,
} from '@k12/contracts';
import { ApiRequestError, api } from '../../lib/api-client';
import { Button } from '../../components/Button';
import { Field, controlClass } from '../../components/Field';
import { useSession } from '../auth/session';

const DATE_FORMAT = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

export function SettingsPage() {
  const { state } = useSession();
  const self = state.status === 'authenticated' ? state.admin : undefined;

  return (
    <div className="min-h-screen">
      <header className="border-b border-edge bg-ink">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
          <h1 className="font-display text-lg font-bold text-white">Settings</h1>
          <Link
            to="/admin/inquiries"
            className="rounded-lg px-3 py-2 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white"
          >
            Back to enquiries
          </Link>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-5 py-8">
        <ChangePasswordSection />
        <AdminAccountsSection selfId={self?.id} />
      </main>
    </div>
  );
}

function ChangePasswordSection() {
  const [result, setResult] = useState<{ kind: 'ok' | 'error'; message: string } | undefined>();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePassword>({
    resolver: standardSchemaResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setResult(undefined);
    try {
      await api.post('/auth/change-password', values);
      reset();
      setResult({
        kind: 'ok',
        message: 'Password changed. Any other sessions have been signed out.',
      });
    } catch (error) {
      setResult({
        kind: 'error',
        message:
          error instanceof ApiRequestError ? error.message : 'Could not change the password.',
      });
    }
  });

  return (
    <section className="rounded-card border border-edge bg-surface p-6">
      <h2 className="font-display text-xl font-bold">Your password</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Changing it signs out every other session, including any that were already open.
      </p>

      {result === undefined ? null : (
        <div
          role="alert"
          className={`mt-4 rounded-lg border px-4 py-3 text-sm font-medium ${
            result.kind === 'ok'
              ? 'border-sage bg-sage-wash text-sage'
              : 'border-clay bg-clay-wash text-clay'
          }`}
        >
          {result.message}
        </div>
      )}

      <form
        onSubmit={(event) => void onSubmit(event)}
        noValidate
        className="mt-5 grid max-w-md gap-4"
      >
        <Field label="Current password" error={errors.currentPassword?.message} required>
          {(a11y) => (
            <input
              {...a11y}
              {...register('currentPassword')}
              type="password"
              autoComplete="current-password"
              className={controlClass}
            />
          )}
        </Field>

        <Field
          label="New password"
          error={errors.newPassword?.message}
          hint="At least 12 characters, with an uppercase letter, a lowercase letter and a digit."
          required
        >
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

        <div>
          <Button type="submit" variant="primary" busy={isSubmitting} busyLabel="Changing">
            Change password
          </Button>
        </div>
      </form>
    </section>
  );
}

function AdminAccountsSection({ selfId }: { selfId: string | undefined }) {
  const queryClient = useQueryClient();
  const [generated, setGenerated] = useState<{ email: string; password: string } | undefined>();
  const [failure, setFailure] = useState<string | undefined>();

  const admins = useQuery({
    queryKey: ['admins'],
    queryFn: ({ signal }) => api.get<{ admins: AdminSummary[] }>('/admins', signal),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateAdmin>({
    resolver: standardSchemaResolver(createAdminSchema),
    defaultValues: { email: '', fullName: '' },
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => api.delete(`/admins/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admins'] }),
    onError: (error) =>
      setFailure(error instanceof ApiRequestError ? error.message : 'Could not deactivate.'),
  });

  const onSubmit = handleSubmit(async (values) => {
    setFailure(undefined);
    setGenerated(undefined);
    try {
      const created = await api.post<{ admin: AdminSummary; initialPassword: string }>(
        '/admins',
        values,
      );
      // Shown once. The server does not keep it in a retrievable form.
      setGenerated({ email: created.admin.email, password: created.initialPassword });
      reset();
      await queryClient.invalidateQueries({ queryKey: ['admins'] });
    } catch (error) {
      setFailure(
        error instanceof ApiRequestError ? error.message : 'Could not create the account.',
      );
    }
  });

  return (
    <section className="rounded-card border border-edge bg-surface p-6">
      <h2 className="font-display text-xl font-bold">Staff accounts</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Anyone with an account here can add or remove colleagues.
      </p>

      {failure === undefined ? null : (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-clay bg-clay-wash px-4 py-3 text-sm font-medium text-clay"
        >
          {failure}
        </div>
      )}

      {generated === undefined ? null : (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-marigold bg-marigold-wash px-4 py-3"
        >
          <p className="text-sm font-semibold text-marigold-deep">
            Account created for {generated.email}
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            This password is shown once and cannot be retrieved. Copy it now and give it to them
            directly.
          </p>
          <code className="mt-2 block rounded border border-marigold/40 bg-surface px-3 py-2 font-mono text-sm break-all">
            {generated.password}
          </code>
        </div>
      )}

      <form
        onSubmit={(event) => void onSubmit(event)}
        noValidate
        className="mt-5 grid gap-4 sm:grid-cols-[1fr_1fr_auto]"
      >
        <Field label="Email" error={errors.email?.message} required>
          {(a11y) => (
            <input {...a11y} {...register('email')} type="email" className={controlClass} />
          )}
        </Field>
        <Field label="Full name" error={errors.fullName?.message} required>
          {(a11y) => (
            <input {...a11y} {...register('fullName')} type="text" className={controlClass} />
          )}
        </Field>
        <div className="flex items-end">
          <Button type="submit" variant="primary" busy={isSubmitting} busyLabel="Adding">
            Add colleague
          </Button>
        </div>
      </form>

      <div className="mt-6 overflow-x-auto">
        {admins.isLoading ? (
          <p className="py-6 text-center text-ink-muted">Loading accounts...</p>
        ) : admins.isError ? (
          <p role="alert" className="py-6 text-center font-medium text-clay">
            Could not load accounts.
          </p>
        ) : (
          <table className="w-full min-w-[34rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-edge text-left text-xs tracking-wide text-ink-muted uppercase">
                <th scope="col" className="px-3 py-2 font-semibold">
                  Name
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Email
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Last signed in
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {admins.data?.admins.map((admin) => (
                <tr key={admin.id} className="border-b border-edge/70 last:border-0">
                  <td className="px-3 py-3 font-medium">{admin.fullName}</td>
                  <td className="px-3 py-3 text-ink-muted">{admin.email}</td>
                  <td className="px-3 py-3 text-ink-muted">
                    {admin.lastLoginAt === null
                      ? 'Never'
                      : DATE_FORMAT.format(new Date(admin.lastLoginAt))}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {admin.id === selfId ? (
                      <span className="text-xs text-ink-faint">This is you</span>
                    ) : (
                      <Button
                        variant="danger"
                        busy={deactivate.isPending && deactivate.variables === admin.id}
                        busyLabel="Removing"
                        onClick={() => deactivate.mutate(admin.id)}
                      >
                        Deactivate
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
