import { WebhookAccepted } from '@devimpact/shared';
import { Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';

import { Public } from '../auth/auth.decorators';
import { ApiDoc } from '../common/zod-validation';
import { RateLimit } from '../throttle/rate-limit';
import { WebhooksService } from './webhooks.service';

import type { Request } from 'express';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  /** GitHub App webhook (HMAC `X-Hub-Signature-256` with GITHUB_WEBHOOK_SECRET, raw body). */
  @Post('github')
  @Public()
  @RateLimit('webhook')
  @HttpCode(202)
  @ApiDoc({
    summary: 'GitHub App webhook receiver (signature-gated, idempotent per delivery)',
    tags: ['webhooks'],
    status: 202,
    response: WebhookAccepted,
  })
  github(
    @Req() req: Request,
    @Headers('x-github-event') event?: string,
    @Headers('x-github-delivery') delivery?: string,
    @Headers('x-hub-signature-256') signature?: string,
  ) {
    return this.webhooks.receiveGitHub(req.body, { event, delivery, signature });
  }
}
