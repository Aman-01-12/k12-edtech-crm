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
    'Someone asked to reset the password for your K12 Hunar staff account.',
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
