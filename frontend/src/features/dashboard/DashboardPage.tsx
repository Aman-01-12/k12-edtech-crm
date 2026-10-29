import { Link } from 'react-router';
import {
  INQUIRY_CATEGORIES,
  INQUIRY_CATEGORY_LABELS,
  INQUIRY_STATUSES,
  INQUIRY_STATUS_LABELS,
  USER_TYPES,
  USER_TYPE_LABELS,
  type InquiryCategory,
  type UserType,
} from '@k12/contracts';
import { Button } from '../../components/Button';
import { StatusRail } from '../../components/StatusRail';
import { apiDownloadUrl } from '../../lib/api-client';
import { useSession } from '../auth/session';
import { useInquiryDashboard } from './useInquiries';

const DATE_FORMAT = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function DashboardPage() {
  const { state, signOut } = useSession();
  const dashboard = useInquiryDashboard();
  const { list, summary } = dashboard;

  const admin = state.status === 'authenticated' ? state.admin : undefined;

  return (
    <div className="min-h-screen">
      <header className="border-b border-edge bg-ink">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <p className="font-display text-xs font-semibold tracking-[0.18em] text-marigold uppercase">
              K12 Hunar
            </p>
            <h1 className="font-display text-lg font-bold text-white">Enquiries</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-white/70 sm:inline">{admin?.email}</span>
            <Link
              to="/admin/settings"
              className="rounded-lg px-3 py-2 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white"
            >
              Settings
            </Link>
            <Button variant="ghost" onClick={() => void signOut()}>
              <span className="text-white/80">Sign out</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-6">
        {/* Fixed height, so arriving numbers do not shift the layout. */}
        <section aria-label="Summary" className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <SummaryCard
            label="Total"
            value={summary.data?.total}
            loading={summary.isLoading}
            emphasis
          />
          {INQUIRY_STATUSES.map((status) => (
            <SummaryCard
              key={status}
              label={INQUIRY_STATUS_LABELS[status]}
              value={summary.data?.byStatus[status]}
              loading={summary.isLoading}
            />
          ))}
        </section>

        <section
          aria-label="Filters"
          className="mt-6 rounded-card border border-edge bg-surface p-4"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Search name or phone</span>
              <input
                type="search"
                value={dashboard.filters.searchInput}
                onChange={(event) => dashboard.setSearchInput(event.target.value)}
                placeholder="Priya, or 98765"
                className="rounded-lg border border-edge px-3 py-2"
              />
            </label>

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Category</span>
              <select
                value={dashboard.filters.category ?? ''}
                onChange={(event) =>
                  dashboard.setCategory(
                    event.target.value === '' ? undefined : (event.target.value as InquiryCategory),
                  )
                }
                className="rounded-lg border border-edge px-3 py-2"
              >
                <option value="">All categories</option>
                {INQUIRY_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {INQUIRY_CATEGORY_LABELS[category]}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">User type</span>
              <select
                value={dashboard.filters.userType ?? ''}
                onChange={(event) =>
                  dashboard.setUserType(
                    event.target.value === '' ? undefined : (event.target.value as UserType),
                  )
                }
                className="rounded-lg border border-edge px-3 py-2"
              >
                <option value="">All user types</option>
                {USER_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {USER_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-end gap-2">
              <Button onClick={dashboard.clearFilters} disabled={!dashboard.hasActiveFilters}>
                Clear
              </Button>
              <a
                href={apiDownloadUrl(`/inquiries/export${dashboard.exportQueryString}`)}
                className="inline-flex items-center rounded-lg border border-edge bg-surface px-4 py-2.5 text-sm font-semibold hover:border-ink-faint"
              >
                Export CSV
              </a>
            </div>
          </div>
        </section>

        {/* Announces result changes for anyone not watching the table. */}
        <p aria-live="polite" className="sr-only">
          {list.isLoading
            ? 'Loading enquiries'
            : `${list.data?.items.length ?? 0} enquiries shown on page ${dashboard.page.number}`}
        </p>

        <section aria-label="Enquiries" className="mt-6">
          {list.isLoading ? (
            <TableFrame>
              <p className="p-8 text-center text-ink-muted">Loading enquiries...</p>
            </TableFrame>
          ) : list.isError ? (
            <TableFrame>
              <div className="p-8 text-center" role="alert">
                <p className="font-medium text-clay">Could not load enquiries.</p>
                <div className="mt-4 flex justify-center">
                  <Button onClick={() => void list.refetch()}>Try again</Button>
                </div>
              </div>
            </TableFrame>
          ) : (list.data?.items.length ?? 0) === 0 ? (
            <TableFrame>
              <p className="p-8 text-center text-ink-muted">
                {dashboard.hasActiveFilters
                  ? 'Nothing matched those filters. Try clearing them.'
                  : 'No enquiries yet. Submissions from the public form appear here.'}
              </p>
            </TableFrame>
          ) : (
            <TableFrame>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[60rem] border-collapse text-sm">
                  <caption className="sr-only">
                    Submitted enquiries, most recent first, page {dashboard.page.number}
                  </caption>
                  <thead>
                    <tr className="border-b border-edge text-left text-xs tracking-wide text-ink-muted uppercase">
                      <th scope="col" className="px-4 py-3 font-semibold">
                        Name
                      </th>
                      <th scope="col" className="px-4 py-3 font-semibold">
                        Contact
                      </th>
                      <th scope="col" className="px-4 py-3 font-semibold">
                        User type
                      </th>
                      <th scope="col" className="px-4 py-3 font-semibold">
                        Category
                      </th>
                      <th scope="col" className="px-4 py-3 font-semibold">
                        Received
                      </th>
                      {/* A floor, so the rail is never squeezed and clipped. */}
                      <th scope="col" className="min-w-[12rem] px-4 py-3 font-semibold">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data?.items.map((inquiry) => (
                      <tr key={inquiry.id} className="border-b border-edge/70 last:border-0">
                        <td className="px-4 py-3">
                          <p className="font-medium text-ink">{inquiry.fullName}</p>
                          <p
                            className="mt-0.5 max-w-xs truncate text-xs text-ink-muted"
                            title={inquiry.message}
                          >
                            {inquiry.message}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-ink-muted">
                          <a
                            href={`tel:${inquiry.phone}`}
                            className="block hover:text-ink hover:underline"
                          >
                            {inquiry.phone}
                          </a>
                          <a
                            href={`mailto:${inquiry.email}`}
                            className="block text-xs hover:text-ink hover:underline"
                          >
                            {inquiry.email}
                          </a>
                        </td>
                        <td className="px-4 py-3 text-ink-muted">
                          {USER_TYPE_LABELS[inquiry.userType]}
                        </td>
                        <td className="px-4 py-3 text-ink-muted">
                          {INQUIRY_CATEGORY_LABELS[inquiry.category]}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-ink-muted">
                          {DATE_FORMAT.format(new Date(inquiry.createdAt))}
                        </td>
                        <td className="px-4 py-3">
                          <StatusRail
                            value={inquiry.status}
                            describedFor={inquiry.fullName}
                            disabled={dashboard.pendingStatusFor === inquiry.id}
                            onChange={(status) =>
                              dashboard.changeStatus({ id: inquiry.id, status })
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TableFrame>
          )}

          <nav aria-label="Pagination" className="mt-4 flex items-center justify-between">
            <Button onClick={dashboard.page.previous} disabled={!dashboard.page.hasPrevious}>
              Previous
            </Button>
            <span className="text-sm text-ink-muted">Page {dashboard.page.number}</span>
            <Button onClick={dashboard.page.next} disabled={!dashboard.page.hasNext}>
              Next
            </Button>
          </nav>
        </section>
      </main>
    </div>
  );
}

function TableFrame({ children }: { children: React.ReactNode }) {
  return <div className="rounded-card border border-edge bg-surface">{children}</div>;
}

function SummaryCard({
  label,
  value,
  loading,
  emphasis = false,
}: {
  label: string;
  value: number | undefined;
  loading: boolean;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-card border px-4 py-3 ${
        emphasis ? 'border-marigold bg-marigold-wash' : 'border-edge bg-surface'
      }`}
    >
      <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold tabular-nums text-ink">
        {loading ? <span className="text-ink-faint">&mdash;</span> : (value ?? 0)}
      </p>
    </div>
  );
}
