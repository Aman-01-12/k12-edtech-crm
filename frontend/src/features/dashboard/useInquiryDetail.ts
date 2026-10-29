import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InquiryDetail, InquiryNote } from '@k12/contracts';
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

  const assign = useMutation({
    mutationFn: (assignedToAdminId: string | null) =>
      api.patch(`/inquiries/${inquiryId ?? ''}/assignment`, { assignedToAdminId }),
    onSuccess: refresh,
  });

  const reply = useMutation({
    mutationFn: (input: { subject: string; body: string }) =>
      api.post<{ note: InquiryNote }>(`/inquiries/${inquiryId ?? ''}/reply`, input),
    onSuccess: refresh,
  });

  return { detail, addNote, deleteNote, assign, reply };
}
