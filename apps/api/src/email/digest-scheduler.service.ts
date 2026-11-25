import { isoWeekday, todayIn } from '@devimpact/shared';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import { limitsFor } from '../entitlements/entitlements';
import { PrismaService } from '../prisma/prisma.service';
import { lastCompleteWeekStart } from './digest-builder.service';
import {
  DIGEST_FANOUT_PATTERN,
  DIGEST_FANOUT_SCHEDULER_ID,
  EMAIL_JOBS,
  EMAIL_QUEUE,
  digestJobId,
  type DigestJobData,
} from './email.constants';

import type { Env } from '../config/env';

/** Local hour (0–23) of `now` in `timeZone`. */
export function localHour(now: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' })
    .formatToParts(now)
    .find((p) => p.type === 'hour')?.value;
  return Number(hour ?? 0) % 24;
}

/**
 * Whether a digest is due for a user at `now` (D-019): it is the user's local digest weekday and
 * the local hour has reached the chosen hour. Using "≥ hour" (not "= hour") keeps DST gaps and
 * worker downtime from skipping a week; the per-week job id + delivery row prevent duplicates
 * (repeated autumn hour, later fan-outs on the same day).
 */
export function digestDue(
  now: Date,
  s: { timezone: string; digestDayOfWeek: number; digestHourLocal: number },
): { due: boolean; weekStart: string } {
  const today = todayIn(s.timezone, now);
  return {
    due: isoWeekday(today) === s.digestDayOfWeek && localHour(now, s.timezone) >= s.digestHourLocal,
    weekStart: lastCompleteWeekStart(today),
  };
}

/**
 * Hourly `email.digest-fanout` (BullMQ job scheduler, registered on worker boot like the sync and
 * metrics schedulers): enqueues `email.digest` for opted-in users whose local digest time has come
 * and who have no delivery for the week yet.
 */
@Injectable()
export class DigestScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(DigestScheduler.name);

  constructor(
    @InjectQueue(EMAIL_QUEUE) private readonly queue: Queue<DigestJobData>,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.get('DIGEST_ENABLED', { infer: true })) {
      await this.queue.removeJobScheduler(DIGEST_FANOUT_SCHEDULER_ID);
      this.logger.log('Weekly digests disabled (DIGEST_ENABLED=false)');
      return;
    }
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') return;
    await this.queue.upsertJobScheduler(
      DIGEST_FANOUT_SCHEDULER_ID,
      { pattern: DIGEST_FANOUT_PATTERN, tz: 'UTC' },
      {
        name: EMAIL_JOBS.fanout,
        data: {} as DigestJobData,
        opts: { removeOnComplete: true, removeOnFail: 50 },
      },
    );
    this.logger.log(
      `Job scheduler "${DIGEST_FANOUT_SCHEDULER_ID}" registered (${DIGEST_FANOUT_PATTERN})`,
    );
  }

  async fanout(now = new Date()): Promise<{ checked: number; queued: number }> {
    // user-scope: the fan-out deliberately scans every user who opted in to the digest.
    const candidates = await this.prisma.userSettings.findMany({
      where: { digestEnabled: true },
      select: {
        userId: true,
        timezone: true,
        digestDayOfWeek: true,
        digestHourLocal: true,
        user: { select: { plan: true } },
      },
    });
    let queued = 0;
    for (const s of candidates) {
      if (!limitsFor(s.user.plan).weeklyDigest) continue;
      const { due, weekStart } = digestDue(now, s);
      if (!due) continue;
      const delivered = await this.prisma.digestDelivery.findUnique({
        where: {
          userId_weekStart: { userId: s.userId, weekStart: new Date(`${weekStart}T00:00:00Z`) },
        },
        select: { status: true },
      });
      if (delivered && delivered.status !== 'FAILED') continue;
      await this.queue.add(
        EMAIL_JOBS.digest,
        { userId: s.userId, weekStart },
        {
          jobId: digestJobId(s.userId, weekStart),
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: { age: 8 * 86_400 },
          removeOnFail: { age: 8 * 86_400 },
        },
      );
      queued++;
    }
    this.logger.log({ checked: candidates.length, queued }, 'email.digest-fanout done');
    return { checked: candidates.length, queued };
  }
}
