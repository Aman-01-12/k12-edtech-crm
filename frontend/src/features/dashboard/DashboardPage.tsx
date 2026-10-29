import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  INQUIRY_CATEGORIES,
  INQUIRY_CATEGORY_LABELS,
  INQUIRY_STATUSES,
  INQUIRY_STATUS_LABELS,
  USER_TYPES,
  USER_TYPE_LABELS,
  type AdminSummary,
  type Inquiry,
  type InquiryCategory,
  type InquiryStatus,
  type UserType,
} from '@k12/contracts';
import { Button } from '../../components/Button';
import { selectCompactClass, selectStyle } from '../../components/Field';
import { StatusRail } from '../../components/StatusRail';
import { api, apiDownloadUrl } from '../../lib/api-client';
import { useSession } from '../auth/session';
import { InquiryDetailPanel } from './InquiryDetailPanel';
import { useInquiryDashboard } from './useInquiries';

const DATE_FORMAT = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function DashboardPage() {
  const { state, signOut } = useSession();
  const dashboard = useInquiryDashboard();
  const { list, summary } = dashboard;
  const [openId, setOpenId] = useState<string | undefined>();

  const admin = state.status === 'authenticated' ? state.admin : undefined;

  // Needed by both the owner filter and the panel's assignment control.
  const admins = useQuery({
    queryKey: ['admins'],
    queryFn: ({ signal }) => api.get<{ admins: AdminSummary[] }>('/admins', signal),
  });
  const adminList = admins.data?.admins ?? [];

  const rows = list.data?.items ?? [];
  const openInquiry = rows.find((row) => row.id === openId);

  return (
    <div className="min-h-screen">
      <header className="bg-ink">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-6 py-3.5">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-xs font-semibold tracking-[0.18em] text-marigold uppercase">
              K12 Hunar
            </span>
            <h1 className="font-display text-base font-bold text-white">Enquiries</h1>
          </div>
          <div className="flex items-center gap-1">
            <span className="mr-2 hidden text-sm text-white/60 sm:inline">{admin?.email}</span>
            <Link
              to="/admin/settings"
              className="rounded-md px-3 py-1.5 text-sm font-medium text-white/70 hover:bg-white/10 hover:text-white"
            >
              Settings
            </Link>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-white/70 hover:bg-white/10 hover:text-white"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-6 py-6">
        {/* A single strip of figures, not five bordered boxes. Each is also the
            status filter, so the number you want to act on is the thing you
            click. */}
        <nav aria-label="Filter by status" className="flex flex-wrap items-stretch">
          <StatTab
            label="All"
            value={summary.data?.total}
            active={dashboard.filters.status === undefined}
            onClick={() => dashboard.setStatus(undefined)}
          />
          {INQUIRY_STATUSES.map((status) => (
            <StatTab
              key={status}
              label={INQUIRY_STATUS_LABELS[status]}
              value={summary.data?.byStatus[status]}
              active={dashboard.filters.status === status}
              onClick={() => dashboard.setStatus(status)}
            />
          ))}
        </nav>

        {/* Toolbar and table share one bordered surface: they are one object,
            and giving each its own card was the visual noise ADR 0014 removes. */}
        <section
          aria-label="Enquiries"
          className="mt-4 overflow-hidden rounded-lg border border-edge bg-surface"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-edge px-4 py-3">
            <label className="w-full sm:w-56">
              <span className="sr-only">Search name or phone</span>
              <input
                type="search"
                value={dashboard.filters.searchInput}
                onChange={(event) => dashboard.setSearchInput(event.target.value)}
                placeholder="Search name or phone"
                className="w-full rounded-md border border-edge bg-canvas px-3 py-1.5 text-sm placeholder:text-ink-faint focus:bg-surface"
              />
            </label>

            <select
              value={dashboard.filters.category ?? ''}
              onChange={(event) =>
                dashboard.setCategory(
                  event.target.value === '' ? undefined : (event.target.value as InquiryCategory),
                )
              }
              className={selectCompactClass}
              style={selectStyle}
              aria-label="Filter by category"
            >
              <option value="">All categories</option>
              {INQUIRY_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {INQUIRY_CATEGORY_LABELS[category]}
                </option>
              ))}
            </select>

            <select
              value={dashboard.filters.userType ?? ''}
              onChange={(event) =>
                dashboard.setUserType(
                  event.target.value === '' ? undefined : (event.target.value as UserType),
                )
              }
              className={selectCompactClass}
              style={selectStyle}
              aria-label="Filter by user type"
            >
              <option value="">Anyone</option>
              {USER_TYPES.map((type) => (
                <option key={type} value={type}>
                  {USER_TYPE_LABELS[type]}
                </option>
              ))}
            </select>

            <select
              value={dashboard.filters.assignedTo ?? ''}
              onChange={(event) =>
                dashboard.setAssignedTo(event.target.value === '' ? undefined : event.target.value)
              }
              className={selectCompactClass}
              style={selectStyle}
              aria-label="Filter by owner"
            >
              <option value="">Any owner</option>
              <option value="unassigned">Unassigned</option>
              {admin === undefined ? null : <option value={admin.id}>Mine</option>}
              {adminList
                .filter((entry) => entry.id !== admin?.id)
                .map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.fullName}
                  </option>
                ))}
            </select>

            {dashboard.hasActiveFilters ? (
              <button
                type="button"
                onClick={dashboard.clearFilters}
                className="rounded-md px-2.5 py-1.5 text-sm font-medium text-ink-muted hover:bg-canvas hover:text-ink"
              >
                Clear
              </button>
            ) : null}

            <a
              href={apiDownloadUrl(`/inquiries/export${dashboard.exportQueryString}`)}
              className="ml-auto rounded-md border border-edge px-3 py-1.5 text-sm font-semibold hover:border-ink-faint"
            >
              Export CSV
            </a>
          </div>

          <p aria-live="polite" className="sr-only">
            {list.isLoading ? 'Loading enquiries' : `${rows.length} enquiries shown`}
          </p>

          {list.isLoading ? (
            <p className="px-4 py-16 text-center text-sm text-ink-muted">Loading enquiries...</p>
          ) : list.isError ? (
            <div className="px-4 py-16 text-center" role="alert">
              <p className="text-sm font-medium text-clay">Could not load enquiries.</p>
              <div className="mt-4 flex justify-center">
                <Button onClick={() => void list.refetch()}>Try again</Button>
              </div>
            </div>
          ) : rows.length === 0 ? (
            <p className="px-4 py-16 text-center text-sm text-ink-muted">
              {dashboard.hasActiveFilters
                ? 'Nothing matched those filters.'
                : 'No enquiries yet. Submissions from the public form appear here.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[64rem] border-collapse text-sm">
                <caption className="sr-only">
                  Submitted enquiries, most recent first, page {dashboard.page.number}
                </caption>
                <thead>
                  <tr className="border-b border-edge text-left text-xs tracking-wide text-ink-faint uppercase">
                    <Th>Name</Th>
                    <Th>Contact</Th>
                    <Th>Type</Th>
                    <Th>Category</Th>
                    <Th>Owner</Th>
                    <Th>Received</Th>
                    <Th className="min-w-[12rem]">Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((inquiry) => (
                    <Row
                      key={inquiry.id}
                      inquiry={inquiry}
                      pending={dashboard.pendingStatusFor === inquiry.id}
                      onOpen={() => setOpenId(inquiry.id)}
                      onChangeStatus={(status) =>
                        dashboard.changeStatus({ id: inquiry.id, status })
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <nav
            aria-label="Pagination"
            className="flex items-center justify-between border-t border-edge px-4 py-3"
          >
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

      {openId === undefined ? null : (
        <InquiryDetailPanel
          inquiryId={openId}
          fallback={openInquiry}
          admins={adminList}
          onClose={() => setOpenId(undefined)}
          onChangeStatus={(status) => dashboard.changeStatus({ id: openId, status })}
        />
      )}
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th scope="col" className={`px-4 py-2.5 font-semibold ${className}`}>
      {children}
    </th>
  );
}

/**
 * A row opens the record. The status rail stays live in the row because
 * triaging a queue without opening each one is the common case, so its cell
 * stops the click from bubbling up to the row.
 */
function Row({
  inquiry,
  pending,
  onOpen,
  onChangeStatus,
}: {
  inquiry: Inquiry;
  pending: boolean;
  onOpen: () => void;
  onChangeStatus: (status: InquiryStatus) => void;
}) {
  return (
    <tr
      onClick={onOpen}
      className="cursor-pointer border-b border-edge/60 last:border-0 hover:bg-canvas/70"
    >
      <td className="px-4 py-3">
        {/* A real button, so the row is reachable and announced to a keyboard
            and screen-reader user rather than being a click-only surface. */}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          className="text-left font-medium text-ink hover:text-marigold-deep hover:underline"
        >
          {inquiry.fullName}
        </button>
        <p className="mt-0.5 max-w-xs truncate text-xs text-ink-faint">{inquiry.message}</p>
      </td>
      <td className="px-4 py-3 text-ink-muted">
        <span className="block">{inquiry.phone}</span>
        <span className="block max-w-[14rem] truncate text-xs">{inquiry.email}</span>
      </td>
      <td className="px-4 py-3 text-ink-muted">{USER_TYPE_LABELS[inquiry.userType]}</td>
      <td className="px-4 py-3 text-ink-muted">{INQUIRY_CATEGORY_LABELS[inquiry.category]}</td>
      <td className="px-4 py-3">
        {inquiry.assignedToName === null ? (
          <span className="text-xs text-ink-faint">Unassigned</span>
        ) : (
          <span className="text-ink-muted">{inquiry.assignedToName}</span>
        )}
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-ink-muted">
        {DATE_FORMAT.format(new Date(inquiry.createdAt))}
      </td>
      <td className="px-4 py-3" onClick={(event) => event.stopPropagation()} role="presentation">
        <StatusRail
          value={inquiry.status}
          describedFor={inquiry.fullName}
          disabled={pending}
          onChange={onChangeStatus}
        />
      </td>
    </tr>
  );
}

/** A figure that is also the filter for the thing it counts. */
function StatTab({
  label,
  value,
  active,
  onClick,
}: {
  label: string;
  value: number | undefined;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`-mb-px border-b-2 px-5 py-2.5 text-left transition-colors ${
        active
          ? 'border-marigold text-ink'
          : 'border-transparent text-ink-muted hover:border-edge hover:text-ink'
      }`}
    >
      <span className="block font-display text-2xl font-bold tabular-nums">
        {value ?? <span className="text-ink-faint">&mdash;</span>}
      </span>
      <span className="block text-xs font-medium tracking-wide uppercase">{label}</span>
    </button>
  );
}
