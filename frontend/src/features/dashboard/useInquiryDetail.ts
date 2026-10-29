import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Inquiry, InquiryDetail, InquiryNote, Page } from '@k12/contracts';
import { api } from '../../lib/api-client';

/**
 * One enquiry's detail panel.
 *
 * Kept separate from the list hook because it has a different lifetime: the
 * list survives opening and closing the panel, and a note added here must
 * invalidate this record without refetching the whole table.
 */
export function useInquiryDetail(inquiryId: string | undefined) {
  const queryClient = useQueryClient();
  const key = ['inquiry', inquiryId];

  const detail = useQuery({
    queryKey: key,
    enabled: inquiryId !== undefined,
    queryFn: ({ signal }) => api.get<InquiryDetail>(`/inquiries/${inquiryId ?? ''}`, signal),
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: key });
    // The row's status or owner may have moved, so the table is stale too.
    void queryClient.invalidateQueries({ queryKey: ['inquiries'] });
    void queryClient.invalidateQueries({ queryKey: ['inquiries-summary'] });
  }

  const addNote = useMutation({
    mutationFn: (body: string) =>
      api.post<{ note: InquiryNote }>(`/inquiries/${inquiryId ?? ''}/notes`, { body }),
    onSuccess: refresh,
  });

  const deleteNote = useMutation({
    mutationFn: (noteId: string) => api.delete(`/inquiries/${inquiryId ?? ''}/notes/${noteId}`),
    onSuccess: refresh,
  });

  /**
   * Optimistic, like the status rail.
   *
   * `assignedToName` is passed in rather than derived here because only the
   * caller holds the admin list; the server resolves the name itself from the
   * id, so this value is a prediction that `onSuccess` then reconciles.
   */
  const assign = useMutation({
    mutationFn: (input: { assignedToAdminId: string | null; assignedToName: string | null }) =>
      api.patch(`/inquiries/${inquiryId ?? ''}/assignment`, {
        assignedToAdminId: input.assignedToAdminId,
      }),

    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: key });

      const previousDetail = queryClient.getQueryData<InquiryDetail>(key);
      // Every list page currently cached, because the row may be on any of them.
      const previousLists = queryClient.getQueriesData<Page<Inquiry>>({
        queryKey: ['inquiries'],
      });

      const owner = {
        assignedToAdminId: input.assignedToAdminId,
        assignedToName: input.assignedToName,
      };

      queryClient.setQueryData<InquiryDetail>(key, (current) =>
        current === undefined ? current : { ...current, inquiry: { ...current.inquiry, ...owner } },
      );

      queryClient.setQueriesData<Page<Inquiry>>({ queryKey: ['inquiries'] }, (current) =>
        current === undefined
          ? current
          : {
              ...current,
              items: current.items.map((item) =>
                item.id === inquiryId ? { ...item, ...owner } : item,
              ),
            },
      );

      return { previousDetail, previousLists };
    },

    onError: (_error, _input, context) => {
      if (context?.previousDetail !== undefined) {
        queryClient.setQueryData(key, context.previousDetail);
      }
      for (const [listKey, data] of context?.previousLists ?? []) {
        queryClient.setQueryData(listKey, data);
      }
    },

    // Still refetched: the assignment adds a timeline entry this cannot predict.
    onSuccess: refresh,
  });

  const reply = useMutation({
    mutationFn: (input: { subject: string; body: string }) =>
      api.post<{ note: InquiryNote }>(`/inquiries/${inquiryId ?? ''}/reply`, input),
    onSuccess: refresh,
  });

  return { detail, addNote, deleteNote, assign, reply };
}
