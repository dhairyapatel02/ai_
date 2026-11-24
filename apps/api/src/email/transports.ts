import { Logger } from '@nestjs/common';

import { nativeRequire } from '../common/native-require';

import type { Env } from '../config/env';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

export interface SentEmail {
  id: string;
}

/**
 * Email provider abstraction (P12). Implementations never log message bodies outside the console
 * transport (development) and never throw provider payloads to callers: errors carry a short,
 * safe message (status / code only).
 */
export interface EmailTransport {
  readonly name: Env['EMAIL_TRANSPORT'];
  send(message: EmailMessage & { from: string }): Promise<SentEmail>;
}

export class EmailSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailSendError';
  }
}

let counter = 0;
const nextId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** Development default: prints the plain-text email to the worker log. */
export class ConsoleEmailTransport implements EmailTransport {
  readonly name = 'console' as const;
  private readonly logger = new Logger('Email');

  send(message: EmailMessage & { from: string }): Promise<SentEmail> {
    const id = nextId('console');
    this.logger.log(
      `\n─── email ${id} ───\nFrom: ${message.from}\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n─── end ───`,
    );
    return Promise.resolve({ id });
  }
}

/** Tests: keeps messages in memory (`sent`), optionally failing the next N sends. */
export class MemoryEmailTransport implements EmailTransport {
  readonly name = 'memory' as const;
  readonly sent: (EmailMessage & { from: string; id: string })[] = [];
  failNext = 0;

  send(message: EmailMessage & { from: string }): Promise<SentEmail> {
    if (this.failNext > 0) {
      this.failNext--;
      return Promise.reject(new EmailSendError('memory transport: simulated failure'));
    }
    const id = nextId('memory');
    this.sent.push({ ...message, id });
    return Promise.resolve({ id });
  }

  clear() {
    this.sent.length = 0;
    this.failNext = 0;
  }
}

interface NodemailerTransporter {
  sendMail(options: Record<string, unknown>): Promise<{ messageId?: string }>;
}
interface NodemailerModule {
  createTransport(url: string): NodemailerTransporter;
}

/** SMTP via nodemailer (loaded only when selected). */
export class SmtpEmailTransport implements EmailTransport {
  readonly name = 'smtp' as const;
  private transporter: NodemailerTransporter | null = null;

  constructor(private readonly url: string) {}

  async send(message: EmailMessage & { from: string }): Promise<SentEmail> {
    this.transporter ??= (
      nativeRequire(__filename)('nodemailer') as NodemailerModule
    ).createTransport(this.url);
    try {
      const info = await this.transporter.sendMail({
        from: message.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: message.headers,
      });
      return { id: info.messageId ?? nextId('smtp') };
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      throw new EmailSendError(`SMTP send failed${typeof code === 'string' ? ` (${code})` : ''}`);
    }
  }
}

/** Resend HTTP API (`POST /emails`, Bearer key). */
export class ResendEmailTransport implements EmailTransport {
  readonly name = 'resend' as const;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  async send(message: EmailMessage & { from: string }): Promise<SentEmail> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/emails`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: message.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          headers: message.headers,
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new EmailSendError('Resend request failed (network)');
    }
    if (!res.ok) throw new EmailSendError(`Resend rejected the message (HTTP ${res.status})`);
    const body = (await res.json().catch(() => ({}))) as { id?: unknown };
    return { id: typeof body.id === 'string' ? body.id : nextId('resend') };
  }
}

export function createEmailTransport(env: Env): EmailTransport {
  switch (env.EMAIL_TRANSPORT) {
    case 'memory':
      return new MemoryEmailTransport();
    case 'smtp':
      return new SmtpEmailTransport(env.SMTP_URL ?? '');
    case 'resend':
      return new ResendEmailTransport(env.RESEND_API_KEY ?? '', env.RESEND_API_URL);
    default:
      return new ConsoleEmailTransport();
  }
}
