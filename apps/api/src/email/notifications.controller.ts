import {
  DigestPreviewResponse,
  UnsubscribeInput,
  UnsubscribeResponse,
  todayIn,
} from '@devimpact/shared';
import { Controller, HttpCode, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type AuthUser, CurrentUser, Public } from '../auth/auth.decorators';
import { AppException } from '../common/app-exception';
import { ApiDoc, ZodBody } from '../common/zod-validation';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimit } from '../throttle/rate-limit';
import { DigestBuilder, lastCompleteWeekStart } from './digest-builder.service';
import { renderDigest } from './digest-template';
import { verifyUnsubscribeToken } from './unsubscribe-token';

import type { Env } from '../config/env';

/** API_CONTRACT_V2 §17 — notifications (F-63, F-65). */
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly builder: DigestBuilder,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * One-click unsubscribe from an email link — no sign-in (`public` class, keyed by IP). The token
   * is HMAC-signed and expires; replaying a valid token repeats the same opt-out (idempotent).
   * Invalid, expired and unknown-user tokens all answer 400 with a reason (no existence leak:
   * the reason only distinguishes "expired" from "anything else").
   */
  @Post('unsubscribe')
  @Public()
  @RateLimit('public')
  @HttpCode(200)
  @ApiDoc({
    summary: 'Unsubscribe with a signed email token (no sign-in)',
    tags: ['notifications'],
    rateLimit: 'public',
    response: UnsubscribeResponse,
  })
  async unsubscribe(@ZodBody(UnsubscribeInput) body: UnsubscribeInput) {
    const result = verifyUnsubscribeToken(
      this.config.get('UNSUBSCRIBE_TOKEN_SECRET', { infer: true }),
      body.token,
    );
    const invalid = (reason: 'invalid' | 'expired') =>
      new AppException(
        'VALIDATION_FAILED',
        reason === 'expired'
          ? 'This unsubscribe link has expired'
          : 'This unsubscribe link is invalid',
        { reason, issues: [{ path: 'body.token', message: `Token ${reason}`, code: reason }] },
      );
    if (!result.ok) throw invalid(result.reason);
    const { userId, list } = result.claims;
    const data =
      list === 'all'
        ? { digestEnabled: false, notifySyncFailures: false, notifyDocumentReady: false }
        : { digestEnabled: false };
    const { count } = await this.prisma.userSettings.updateMany({ where: { userId }, data });
    if (count === 0) throw invalid('invalid');
    return { unsubscribed: true as const, list };
  }

  /** The digest for the last complete week as it would be sent (no email, no AI summary). */
  @Post('digest/preview')
  @HttpCode(200)
  @ApiDoc({
    summary: "Preview last week's digest (subject, HTML, text) — nothing is sent",
    tags: ['notifications'],
    response: DigestPreviewResponse,
  })
  async preview(@CurrentUser() user: AuthUser) {
    const settings = await this.prisma.userSettings.findUnique({
      where: { userId: user.id },
      select: { timezone: true },
    });
    const weekStart = lastCompleteWeekStart(todayIn(settings?.timezone ?? 'UTC'));
    const built = await this.builder.build(user.id, weekStart);
    if (!built) throw AppException.unauthenticated('Account not found');
    return { ...renderDigest(built.content), weekStart };
  }
}
