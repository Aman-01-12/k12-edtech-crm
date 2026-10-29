import { z } from 'zod';

/**
 * Domain vocabulary shared by the API, the database and the UI.
 *
 * The string values are the exact labels of the Postgres enum types declared in
 * `schema.sql`. Changing one of these arrays without changing the matching
 * `CREATE TYPE` is a breaking change, so they are kept in one place rather than
 * restated per layer.
 */

export const USER_TYPES = ['parent', 'student', 'school'] as const;
export type UserType = (typeof USER_TYPES)[number];
export const userTypeSchema = z.enum(USER_TYPES);

export const INQUIRY_CATEGORIES = ['scholarship', 'concert', 'admission', 'general_query'] as const;
export type InquiryCategory = (typeof INQUIRY_CATEGORIES)[number];
export const inquiryCategorySchema = z.enum(INQUIRY_CATEGORIES);

export const INQUIRY_STATUSES = ['new', 'in_progress', 'resolved', 'closed'] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];
export const inquiryStatusSchema = z.enum(INQUIRY_STATUSES);

/**
 * Human-readable labels.
 *
 * These live beside the enum values so the display text cannot drift from the
 * stored value. `Record` keyed by the union means adding a new enum member
 * fails the type-check until its label exists.
 */

export const USER_TYPE_LABELS: Readonly<Record<UserType, string>> = {
  parent: 'Parent',
  student: 'Student',
  school: 'School',
};

export const INQUIRY_CATEGORY_LABELS: Readonly<Record<InquiryCategory, string>> = {
  scholarship: 'Scholarship',
  concert: 'Concert',
  admission: 'Admission',
  general_query: 'General Query',
};

export const INQUIRY_STATUS_LABELS: Readonly<Record<InquiryStatus, string>> = {
  new: 'New',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  closed: 'Closed',
};
