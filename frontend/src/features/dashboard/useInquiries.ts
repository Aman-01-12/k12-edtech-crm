import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Inquiry, InquiryCategory, InquiryStatus, Page, UserType } from '@k12/contracts';
import { INQUIRY_STATUSES } from '@k12/contracts';
import { api } from '../../lib/api-client';

/**
 * Dashboard server state.
 *
 * Filters and the search term live here; the cursor is reset whenever either
 * changes, because a cursor describes a position in one result set and applying
 * it to a different one would silently skip rows.
 */

export interface InquiryFilters {
  category?: InquiryCategory | undefined;
  userType?: UserType | undefined;
  status?: InquiryStatus | undefined;
  /** An admin id, or the literal `unassigned`. */
  assignedTo?: string | undefined;
  search?: string | undefined;
}

export interface InquirySummaryResult {
  total: number;
  byStatus: Record<InquiryStatus, number>;
}

const SEARCH_DEBOUNCE_MS = 350;
const SEARCH_MIN_LENGTH = 2;

function toQueryString(filters: InquiryFilters, cursor: string | undefined): string {
  const params = new URLSearchParams();
  if (filters.category !== undefined) params.set('category', filters.category);
  if (filters.userType !== undefined) params.set('userType', filters.userType);
  if (filters.status !== undefined) params.set('status', filters.status);
  if (filters.assignedTo !== undefined) params.set('assignedTo', filters.assignedTo);
  if (filters.search !== undefined && filters.search.length >= SEARCH_MIN_LENGTH) {
    params.set('search', filters.search);
  }
  if (cursor !== undefined) params.set('cursor', cursor);
  const query = params.toString();
  return query.length > 0 ? `?${query}` : '';
}

/** Debounces the search term, so typing does not fire one request per keystroke. */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

export function useInquiryDashboard() {
  const queryClient = useQueryClient();

  const [category, setCategory] = useState<InquiryCategory | undefined>();
  const [userType, setUserType] = useState<UserType | undefined>();
  const [status, setStatus] = useState<InquiryStatus | undefined>();
  const [assignedTo, setAssignedTo] = useState<string | undefined>();
  const [searchInput, setSearchInput] = useState('');
  const [cursor, setCursor] = useState<string | undefined>();
  const [pageStack, setPageStack] = useState<(string | undefined)[]>([]);

  const search = useDebounced(searchInput.trim(), SEARCH_DEBOUNCE_MS);

  const filters = useMemo<InquiryFilters>(
    () => ({
      category,
      userType,
      status,
      assignedTo,
      search: search.length >= SEARCH_MIN_LENGTH ? search : undefined,
    }),
    [category, userType, status, assignedTo, search],
  );

  // Any filter change invalidates the cursor; see the note above.
  useEffect(() => {
    setCursor(undefined);
    setPageStack([]);
  }, [category, userType, status, assignedTo, search]);

  const queryString = toQueryString(filters, cursor);

  const listQuery = useQuery({
    queryKey: ['inquiries', queryString],
    // The signal comes from the query cache, so a superseded request is
    // aborted rather than left to resolve and overwrite a newer result.
    queryFn: ({ signal }) => api.get<Page<Inquiry>>(`/inquiries${queryString}`, signal),
  });

  const summaryQuery = useQuery({
    // Independent of the list, so a failed summary leaves the table usable.
    queryKey: ['inquiries-summary', toQueryString(filters, undefined)],
    queryFn: ({ signal }) =>
      api.get<InquirySummaryResult>(
        `/inquiries/summary${toQueryString(filters, undefined)}`,
        signal,
      ),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: InquiryStatus }) =>
      api.patch<{ inquiry: Inquiry }>(`/inquiries/${id}/status`, { status }),

    // Optimistic: the rail moves immediately and rolls back if the server says no.
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ['inquiries', queryString] });
      const previous = queryClient.getQueryData<Page<Inquiry>>(['inquiries', queryString]);

      queryClient.setQueryData<Page<Inquiry>>(['inquiries', queryString], (current) =>
        current === undefined
          ? current
          : {
              ...current,
              items: current.items.map((item) => (item.id === id ? { ...item, status } : item)),
            },
      );

      return { previous };
    },

    onError: (_error, _variables, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(['inquiries', queryString], context.previous);
      }
    },

    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['inquiries-summary'] });
      // The detail panel is a separate cache entry. Without this, advancing the
      // rail from inside the panel updates the server and the row behind it
      // while the panel itself keeps showing the old status and a stale
      // history.
      void queryClient.invalidateQueries({ queryKey: ['inquiry', variables.id] });
    },
  });

  const goToNextPage = useCallback(() => {
    const next = listQuery.data?.nextCursor;
    if (next !== null && next !== undefined) {
      setPageStack((stack) => [...stack, cursor]);
      setCursor(next);
    }
  }, [listQuery.data?.nextCursor, cursor]);

  const goToPreviousPage = useCallback(() => {
    setPageStack((stack) => {
      const copy = [...stack];
      const previous = copy.pop();
      setCursor(previous);
      return copy;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setCategory(undefined);
    setUserType(undefined);
    setStatus(undefined);
    setAssignedTo(undefined);
    setSearchInput('');
  }, []);

  const hasActiveFilters =
    category !== undefined ||
    userType !== undefined ||
    status !== undefined ||
    assignedTo !== undefined ||
    searchInput.trim().length > 0;

  return {
    filters: { category, userType, status, assignedTo, searchInput },
    setCategory,
    setUserType,
    setStatus,
    setAssignedTo,
    setSearchInput,
    clearFilters,
    hasActiveFilters,

    list: listQuery,
    summary: summaryQuery,
    statuses: INQUIRY_STATUSES,

    changeStatus: statusMutation.mutate,
    pendingStatusFor: statusMutation.isPending
      ? (statusMutation.variables as { id: string } | undefined)?.id
      : undefined,
    statusError: statusMutation.error,

    page: {
      next: goToNextPage,
      previous: goToPreviousPage,
      hasNext: listQuery.data?.nextCursor != null,
      hasPrevious: pageStack.length > 0,
      number: pageStack.length + 1,
    },

    exportQueryString: toQueryString(filters, undefined),
  };
}
