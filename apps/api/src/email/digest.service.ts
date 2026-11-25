import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DigestStatus, Prisma } from '@prisma/client';

import { DigestSummaryService } from '../documents/digest-summary.service';
import { PrismaService } from '../prisma/prisma.service';
import { DigestBuilder } from './digest-builder.service';
import { renderDigest } from './digest-template';
import { EMAIL_TRANSPORT, type DigestJobData } from './email.constants';

import type { Env } from '../config/env';
import type { EmailTransport } from './transports';

export type DigestOutcome =
  'sent' | 'skipped_empty' | 'opted_out' | 'already_sent' | 'user_missing' | 'claimed_elsewhere';

const toDbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);

/**
 * `email.digest { userId, weekStart }` (F-63): idempotent per (user, week) through the
 * `digest_deliveries` unique key. The row is claimed before sending (status FAILED, error
 * "sending"), then set to SENT; a retry of a FAILED delivery may send again, a SENT or SKIPPED one
 * never. Opted-out users are not emailed (the setting is re-read at send time). The optional AI
 * summary never blocks or fails a digest.
 */
@Injectable()
export class DigestService {
  private readonly logger = new Logger(DigestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly builder: DigestBuilder,
    private readonly config: ConfigService<Env, true>,
    @Inject(EMAIL_TRANSPORT) private readonly transport: EmailTransport,
    @Optional() private readonly summaries?: DigestSummaryService,
  ) {}

  async deliver(data: DigestJobData, now = new Date()): Promise<DigestOutcome> {
    const { userId, weekStart } = data;
    const settings = await this.prisma.userSettings.findUnique({
      where: { userId },
      select: { digestEnabled: true },
    });
    if (!settings) return 'user_missing';
    if (!settings.digestEnabled) return 'opted_out';

    const existing = await this.prisma.digestDelivery.findUnique({
      where: { userId_weekStart: { userId, weekStart: toDbDate(weekStart) } },
    });
    if (existing && existing.status !== DigestStatus.FAILED) return 'already_sent';

    const built = await this.builder.build(userId, weekStart, now);
    if (!built) return 'user_missing';
    if (built.empty) {
      await this.record(userId, weekStart, DigestStatus.SKIPPED, 'no_activity');
      return 'skipped_empty';
    }
    if (!existing) {
      try {
        await this.prisma.digestDelivery.create({
          data: {
            userId,
            weekStart: toDbDate(weekStart),
            status: DigestStatus.FAILED,
            error: 'sending',
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          return 'claimed_elsewhere';
        }
        throw error;
      }
    }

    let content = built.content;
    try {
      const summary = (await this.summaries?.summarize(userId, weekStart)) ?? null;
      if (summary) {
        content = {
          ...content,
          summary: {
            text: summary.content.summary.text,
            highlights: summary.content.highlights.map((h) => h.text),
          },
        };
      }
    } catch (error) {
      this.logger.warn({ userId, weekStart, err: (error as Error).name }, 'digest summary skipped');
    }

    const rendered = renderDigest(content);
    try {
      await this.transport.send({
        from: this.config.get('EMAIL_FROM', { infer: true }),
        to: built.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        headers: { 'List-Unsubscribe': `<${content.links.unsubscribe}>` },
      });
    } catch (error) {
      await this.record(
        userId,
        weekStart,
        DigestStatus.FAILED,
        (error as Error).message.slice(0, 200),
      );
      throw error;
    }
    await this.record(userId, weekStart, DigestStatus.SENT, null, now);
    this.logger.log({ userId, weekStart, transport: this.transport.name }, 'digest sent');
    return 'sent';
  }

  private async record(
    userId: string,
    weekStart: string,
    status: DigestStatus,
    error: string | null,
    sentAt = new Date(),
  ) {
    await this.prisma.digestDelivery.upsert({
      where: { userId_weekStart: { userId, weekStart: toDbDate(weekStart) } },
      update: { status, error, sentAt },
      create: { userId, weekStart: toDbDate(weekStart), status, error, sentAt },
    });
  }
}
