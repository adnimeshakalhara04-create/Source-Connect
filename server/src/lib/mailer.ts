import type { FastifyBaseLogger } from 'fastify';

/**
 * Outgoing email. No email provider is configured yet (owner action: choose SMTP/transactional provider).
 * Until then messages are written to the server log in development/test only; in production they are
 * dropped with a warning so that no verification/reset link ever appears in production logs.
 */
export interface Mailer { send(to: string, subject: string, text: string): Promise<void>; outbox?: { to: string; subject: string; text: string }[] }

export function createMailer(env: string, log: FastifyBaseLogger): Mailer {
  const outbox: { to: string; subject: string; text: string }[] = [];
  return {
    outbox,
    async send(to, subject, text) {
      if (env === 'production') { log.warn({ subject }, 'email not sent: no email provider configured'); return; }
      outbox.push({ to, subject, text });
      if (outbox.length > 100) outbox.shift();
      log.info({ to, subject, text }, 'email (dev outbox)');
    },
  };
}
