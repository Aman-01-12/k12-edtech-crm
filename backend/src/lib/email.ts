import { Resend } from 'resend';
import { config } from '../config/env.js';
import { logger } from './logger.js';

/**
 * The only module that knows the email provider is Resend.
 *
 * Plain text plus a minimal HTML alternative rather than a templating
 * dependency: this application sends exactly one kind of email, and a template
 * engine would be machinery for a problem it does not have. See
 * docs/adr/0013-password-reset-by-email.md.
 */

const resend = new Resend(config.RESEND_API_KEY);

/**
 * @returns whether the provider accepted the message. Never throws: the caller
 *   must return the same response whether or not an email went out, so a
 *   delivery failure is logged here and reported as a boolean rather than
 *   propagating into the request's outcome.
 */
export async function sendPasswordResetEmail(input: {
  to: string;
  resetUrl: string;
  expiresInMinutes: number;
}): Promise<boolean> {
  const { to, resetUrl, expiresInMinutes } = input;

  const text = [
    'Here is the link to reset the password for your K12 Hunar staff account.',
    '',
    'Open this link to choose a new password:',
    resetUrl,
    '',
    `The link works once and expires in ${String(expiresInMinutes)} minutes.`,
    '',
    'If this was not you, no action is needed. Your password has not changed.',
  ].join('\n');

  const html = [
    '<p>Someone asked to reset the password for your K12 Hunar staff account.</p>',
    `<p><a href="${resetUrl}">Choose a new password</a></p>`,
    `<p>The link works once and expires in ${String(expiresInMinutes)} minutes.</p>`,
    '<p>If this was not you, no action is needed. Your password has not changed.</p>',
  ].join('\n');

  try {
    const { error } = await resend.emails.send({
      from: config.RESEND_FROM_EMAIL,
      to,
      subject: 'Reset your K12 Hunar password',
      text,
      html,
    });

    if (error !== null) {
      // The provider's message, not the recipient or the link.
      logger.error({ err: error }, 'Password reset email rejected by the provider');
      return false;
    }
    return true;
  } catch (error) {
    logger.error({ err: error }, 'Password reset email could not be sent');
    return false;
  }
}

/** Escapes text destined for the HTML alternative of an email. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Emails an applicant a staff reply to their enquiry.
 *
 * @param to - read from the enquiry row, never from the request, so this
 *   cannot be aimed at an arbitrary mailbox.
 * @param replyTo - the acting admin, so the applicant's answer reaches a person
 *   rather than the unattended no-reply sender.
 * @returns whether the provider accepted it. Unlike the reset email, the
 *   caller surfaces this: a staff member must know their reply did not go.
 */
export async function sendInquiryReply(input: {
  to: string;
  replyTo: string;
  subject: string;
  body: string;
  applicantName: string;
}): Promise<boolean> {
  const { to, replyTo, subject, body, applicantName } = input;

  const text = [
    `Hello ${applicantName},`,
    '',
    body,
    '',
    '--',
    'K12 Hunar',
    `Reply to this email to reach us, or write to ${replyTo}.`,
  ].join('\n');

  // The body is staff-authored, but it is still untrusted input to an HTML
  // document, so it is escaped and only then given its line breaks back.
  const html = [
    `<p>Hello ${escapeHtml(applicantName)},</p>`,
    `<p>${escapeHtml(body).replace(/\n/g, '<br />')}</p>`,
    '<hr />',
    `<p style="color:#4a6673;font-size:13px">K12 Hunar &middot; reply to this email, or write to ${escapeHtml(replyTo)}.</p>`,
  ].join('\n');

  try {
    const { error } = await resend.emails.send({
      from: config.RESEND_FROM_EMAIL,
      to,
      replyTo,
      subject,
      text,
      html,
    });

    if (error !== null) {
      logger.error({ err: error }, 'Reply email rejected by the provider');
      return false;
    }
    return true;
  } catch (error) {
    logger.error({ err: error }, 'Reply email could not be sent');
    return false;
  }
}
