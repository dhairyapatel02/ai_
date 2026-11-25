import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentStatus, DocumentType } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { clean, esc, safeHref } from './digest-template';
import { EMAIL_TRANSPORT, type NotificationJobData } from './email.constants';
import { createUnsubscribeToken } from './unsubscribe-token';

import type { Env } from '../config/env';
import type { EmailTransport } from './transports';

const TYPE_LABEL: Partial<Record<DocumentType, string>> = {
  [DocumentType.RESUME]: 'Resume bullets',
  [DocumentType.APPRAISAL]: 'Appraisal',
  [DocumentType.PROMOTION]: 'Promotion packet',
  [DocumentType.IMPACT_NARRATIVE]: 'Impact highlights',
};

export type NotificationOutcome = 'sent' | 'opted_out' | 'not_applicable' | 'user_missing';

/**
 * `email.send` (F-65): "Document ready" (opt-in, `notifyDocumentReady`) and "Sync problems"
 * (`notifySyncFailures`, default on). Re-reads the preference and the record at send time, so a
 * toggle switched off after queueing is respected. Text is escaped; links are built here.
 */
@Injectable()
export class NotificationEmailService {
  private readonly logger = new Logger(NotificationEmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @Inject(EMAIL_TRANSPORT) private readonly transport: EmailTransport,
  ) {}

  private web(path: string): string {
    return `${this.config.get('WEB_URL', { infer: true }).replace(/\/+$/, '')}${path}`;
  }

  async send(job: NotificationJobData): Promise<NotificationOutcome> {
    const user = await this.prisma.user.findUnique({
      where: { id: job.userId },
      select: {
        email: true,
        settings: { select: { notifyDocumentReady: true, notifySyncFailures: true } },
      },
    });
    if (!user) return 'user_missing';
    let message: { subject: string; lead: string; cta: string; href: string } | null = null;
    if (job.kind === 'document_ready') {
      if (!user.settings?.notifyDocumentReady) return 'opted_out';
      const doc = await this.prisma.generatedDocument.findFirst({
        where: { id: job.documentId, userId: job.userId, status: DocumentStatus.READY },
        select: { id: true, type: true, title: true, citationCoverage: true },
      });
      if (!doc) return 'not_applicable';
      const label = TYPE_LABEL[doc.type] ?? 'Document';
      const coverage =
        doc.citationCoverage === null
          ? ''
          : ` — ${String(Math.round(doc.citationCoverage * 100))}% of claims cited`;
      message = {
        subject: `${label} ready`,
        lead: `“${clean(doc.title, 160)}” is ready${coverage}.`,
        cta: 'Open the document',
        href: this.web(`/documents/${doc.id}`),
      };
    } else {
      if (!(user.settings?.notifySyncFailures ?? true)) return 'opted_out';
      const integration = await this.prisma.integration.findFirst({
        where: { id: job.integrationId, userId: job.userId },
        select: { status: true },
      });
      if (!integration) return 'not_applicable';
      message =
        job.problem === 'needs_reauth'
          ? {
              subject: 'GitHub needs reconnecting',
              lead: "DevImpact can't import new work until you reconnect GitHub. Nothing has been deleted.",
              cta: 'Reconnect GitHub',
              href: this.web('/settings/integrations'),
            }
          : {
              subject: 'A DevImpact sync failed',
              lead: 'GitHub returned an error during the last sync. Your data is from the last successful sync.',
              cta: 'Review the sync',
              href: this.web('/settings/integrations'),
            };
    }
    const token = createUnsubscribeToken(
      this.config.get('UNSUBSCRIBE_TOKEN_SECRET', { infer: true }),
      { userId: job.userId, list: 'all' },
      this.config.get('UNSUBSCRIBE_TOKEN_TTL_DAYS', { infer: true }),
    );
    const unsubscribe = this.web(`/unsubscribe?token=${encodeURIComponent(token)}`);
    const settings = this.web('/settings/notifications');
    const href = safeHref(message.href) ?? '';
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(message.subject)}</title></head><body style="margin:0;padding:24px 12px;background:#f7f7f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"><table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px"><tr><td style="padding:24px"><div style="font-size:12px;color:#71717a">DevImpact</div><h1 style="font-size:18px;color:#18181b;margin:8px 0 12px">${esc(message.subject)}</h1><p style="font-size:14px;line-height:21px;color:#18181b">${esc(message.lead)}</p><p style="padding-top:8px"><a href="${esc(href)}" style="display:inline-block;background:#4338ca;color:#ffffff;text-decoration:none;font-size:14px;padding:10px 16px;border-radius:8px">${esc(message.cta)}</a></p></td></tr></table><p style="max-width:560px;margin:12px auto;font-size:12px;color:#71717a"><a href="${esc(settings)}" style="color:#71717a">Email settings</a> · <a href="${esc(unsubscribe)}" style="color:#71717a">Unsubscribe from all DevImpact emails</a> (no sign-in needed).</p></body></html>`;
    const text = `${message.subject}\n\n${message.lead}\n\n${message.cta}: ${href}\n\nEmail settings: ${settings}\nUnsubscribe from all DevImpact emails (no sign-in needed): ${unsubscribe}`;
    await this.transport.send({
      from: this.config.get('EMAIL_FROM', { infer: true }),
      to: user.email,
      subject: message.subject,
      html,
      text,
      headers: { 'List-Unsubscribe': `<${unsubscribe}>` },
    });
    this.logger.log({ userId: job.userId, kind: job.kind }, 'notification email sent');
    return 'sent';
  }
}
