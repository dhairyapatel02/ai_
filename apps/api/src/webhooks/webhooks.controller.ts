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

  /** GitLab project/group webhook (`X-Gitlab-Token` = GITLAB_WEBHOOK_SECRET). */
  @Post('gitlab')
  @Public()
  @RateLimit('webhook')
  @HttpCode(202)
  @ApiDoc({
    summary: 'GitLab webhook receiver (secret token, idempotent per delivery)',
    tags: ['webhooks'],
    status: 202,
    response: WebhookAccepted,
  })
  gitlab(
    @Req() req: Request,
    @Headers('x-gitlab-event') event?: string,
    @Headers('x-gitlab-event-uuid') delivery?: string,
    @Headers('x-gitlab-token') token?: string,
  ) {
    return this.webhooks.receiveProvider('gitlab', req.body, { event, delivery, signature: token });
  }

  /** Jira Cloud webhook (`X-Hub-Signature: sha256=…` with JIRA_WEBHOOK_SECRET). */
  @Post('jira')
  @Public()
  @RateLimit('webhook')
  @HttpCode(202)
  @ApiDoc({
    summary: 'Jira Cloud webhook receiver (HMAC, idempotent per delivery)',
    tags: ['webhooks'],
    status: 202,
    response: WebhookAccepted,
  })
  jira(
    @Req() req: Request,
    @Headers('x-atlassian-webhook-identifier') delivery?: string,
    @Headers('x-hub-signature') signature?: string,
  ) {
    return this.webhooks.receiveProvider('jira', req.body, { delivery, signature });
  }

  /** Linear OAuth-app webhook (`Linear-Signature`, HMAC + 60 s timestamp window). */
  @Post('linear')
  @Public()
  @RateLimit('webhook')
  @HttpCode(202)
  @ApiDoc({
    summary: 'Linear webhook receiver (HMAC + timestamp, idempotent per delivery)',
    tags: ['webhooks'],
    status: 202,
    response: WebhookAccepted,
  })
  linear(
    @Req() req: Request,
    @Headers('linear-event') event?: string,
    @Headers('linear-delivery') delivery?: string,
    @Headers('linear-signature') signature?: string,
  ) {
    return this.webhooks.receiveProvider('linear', req.body, { event, delivery, signature });
  }
}
