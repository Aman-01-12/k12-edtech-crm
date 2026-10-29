import { describe, expect, it } from 'vitest';
import {
  createInquirySchema,
  inquiryIdParamSchema,
  updateInquiryStatusSchema,
  type CreateInquiryInput,
} from './inquiry.js';

/** A submission that should always pass, used as the base for negative cases. */
function validSubmission(): CreateInquiryInput {
  return {
    userType: 'parent',
    category: 'scholarship',
    fullName: 'Priya Sharma',
    email: 'priya@example.com',
    phone: '9876543210',
    message: 'I would like to know about the scholarship application timeline.',
  };
}

describe('createInquirySchema', () => {
  it('given a valid submission, when parsed, then every field is normalized for storage', () => {
    const parsed = createInquirySchema.parse({
      ...validSubmission(),
      fullName: '  Priya   Sharma ',
      email: ' Priya@Example.COM ',
      phone: '+91 98765-43210',
    });

    expect(parsed).toEqual({
      userType: 'parent',
      category: 'scholarship',
      fullName: 'Priya Sharma',
      email: 'priya@example.com',
      phone: '+919876543210',
      message: 'I would like to know about the scholarship application timeline.',
    });
  });

  it('given an unknown field, when parsed, then the submission is rejected rather than stripped', () => {
    // Rejecting rather than ignoring closes the mass-assignment probe: a caller
    // never gets a 201 for a body the server did not fully understand.
    const result = createInquirySchema.safeParse({ ...validSubmission(), status: 'resolved' });

    expect(result.success).toBe(false);
  });

  it.each(['userType', 'category', 'fullName', 'email', 'phone', 'message'] as const)(
    'given a submission missing %s, when parsed, then it is rejected',
    (field) => {
      const body: Record<string, unknown> = { ...validSubmission() };
      delete body[field];

      expect(createInquirySchema.safeParse(body).success).toBe(false);
    },
  );

  it('given a user type outside the permitted set, when parsed, then it is rejected', () => {
    expect(
      createInquirySchema.safeParse({ ...validSubmission(), userType: 'teacher' }).success,
    ).toBe(false);
  });

  it('given a category outside the permitted set, when parsed, then it is rejected', () => {
    expect(
      createInquirySchema.safeParse({ ...validSubmission(), category: 'sports' }).success,
    ).toBe(false);
  });

  it('given several invalid fields, when parsed, then every failing field is reported', () => {
    const result = createInquirySchema.safeParse({
      ...validSubmission(),
      email: 'nope',
      phone: '123',
      message: 'short',
    });

    expect(result.success).toBe(false);
    const failedFields = new Set(result.error?.issues.map((issue) => issue.path[0]));
    expect(failedFields).toEqual(new Set(['email', 'phone', 'message']));
  });

  it('given SQL metacharacters in the message, when parsed, then they survive as literal text', () => {
    const payload = "Robert'); DROP TABLE inquiries; -- 100% sure";
    const parsed = createInquirySchema.parse({ ...validSubmission(), message: payload });

    expect(parsed.message).toBe(payload);
  });
});

describe('updateInquiryStatusSchema', () => {
  it.each(['new', 'in_progress', 'resolved', 'closed'] as const)(
    'given the permitted status %s, when parsed, then it is accepted',
    (status) => {
      expect(updateInquiryStatusSchema.parse({ status })).toEqual({ status });
    },
  );

  it('given a status outside the permitted set, when parsed, then it is rejected', () => {
    expect(updateInquiryStatusSchema.safeParse({ status: 'archived' }).success).toBe(false);
  });

  it('given an attempt to smuggle another column, when parsed, then the body is rejected', () => {
    const result = updateInquiryStatusSchema.safeParse({ status: 'resolved', email: 'a@b.co' });

    expect(result.success).toBe(false);
  });
});

describe('inquiryIdParamSchema', () => {
  it('given a UUID, when parsed, then it is accepted', () => {
    const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    expect(inquiryIdParamSchema.parse({ id })).toEqual({ id });
  });

  it.each(['1', 'not-a-uuid', '../../etc/passwd', "' OR 1=1 --"])(
    'given the malformed id %p, when parsed, then it is rejected before reaching a query',
    (id) => {
      expect(inquiryIdParamSchema.safeParse({ id }).success).toBe(false);
    },
  );
});
