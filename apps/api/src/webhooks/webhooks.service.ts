import { createHash } from 'node:crypto';

import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Provider, WebhookStatus } from '@prisma/client';
import { Queue } from 'bullmq';

import { AppException } from '../common/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import { PROVIDER_ENUM, ProviderRegistry } from '../providers/provider-registry';
import { ACTIVITY_PROVIDER } from '../providers/providers.module';
import { SYNC_JOBS, SYNC_QUEUE, targetedJobId } from '../sync/sync.constants';

import type { ActivityProvider, ProviderWebhookEvent, WebhookAccepted } from '@devimpact/shared';

export interface TargetedJobData {
  deliveryId: string;
  event: ProviderWebhookEvent;
}

const DELIVERY_ID = /^[A-Za-z0-9-]{1,100}$/;
const EVENT_NAME = /^[a-z_]{1,64}$/;
/** GitLab `Merge Request Hook`, Jira `jira:issue_updated`, Linear `Issue`. */
const PROVIDER_EVENT_NAME = /^[A-Za-z_: ]{1,64}$/;

/**
 * Webhook ingress (ARCHITECTURE_V2 §6.4): verify the HMAC over the raw body (timing-safe), record
 * the delivery id for idempotency (replays are acknowledged and ignored), and enqueue a targeted
 * job. Answers in well under a second; all GitHub calls happen in the worker.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ACTIVITY_PROVIDER) private readonly provider: ActivityProvider,
    @InjectQueue(SYNC_QUEUE) private readonly queue: Queue<TargetedJobData>,
    private readonly registry: ProviderRegistry,
  ) {}

  async receiveGitHub(
    rawBody: unknown,
    headers: { event?: string; delivery?: string; signature?: string },
  ): Promise<WebhookAccepted> {
    const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.alloc(0);
    // Authenticate first: unauthenticated callers learn nothing else about the endpoint.
    if (!this.provider.verifyWebhook(body, headers.signature)) {
      throw new AppException('WEBHOOK_SIGNATURE_INVALID', 'Invalid webhook signature');
    }
    if (
      !headers.event ||
      !EVENT_NAME.test(headers.event) ||
      !headers.delivery ||
      !DELIVERY_ID.test(headers.delivery)
    ) {
      throw new AppException(
        'VALIDATION_FAILED',
        'Missing or invalid X-GitHub-Event / X-GitHub-Delivery headers',
      );
    }
    let payload: unknown;
    try {
      payload = JSON.parse(body.toString('utf8'));
    } catch {
      throw new AppException('VALIDATION_FAILED', 'Webhook body is not valid JSON');
    }

    const event = this.provider.parseWebhook(headers.event, payload);
    const installationId = (payload as { installation?: { id?: unknown } }).installation?.id;
    const action = (payload as { action?: unknown }).action;
    const inserted = await this.prisma.webhookDelivery.createMany({
      data: [
        {
          id: headers.delivery,
          provider: Provider.GITHUB,
          event: headers.event,
          action: typeof action === 'string' ? action.slice(0, 64) : null,
          installationId: typeof installationId === 'number' ? BigInt(installationId) : null,
          status: event.kind === 'ignored' ? WebhookStatus.IGNORED : WebhookStatus.RECEIVED,
          processedAt: event.kind === 'ignored' ? new Date() : null,
        },
      ],
      skipDuplicates: true,
    });
    if (inserted.count === 0) {
      this.logger.log({ deliveryId: headers.delivery }, 'Duplicate webhook delivery ignored');
      return { accepted: true, duplicate: true };
    }
    if (event.kind !== 'ignored') {
      await this.queue.add(
        SYNC_JOBS.targeted,
        { deliveryId: headers.delivery, event },
        {
          jobId: targetedJobId(headers.delivery),
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: true,
          removeOnFail: { age: 7 * 86_400 },
        },
      );
    }
    return { accepted: true, duplicate: false };
  }

  /**
   * GitLab / Jira / Linear webhooks (P13, D-030): provider-specific authenticity check first
   * (GitLab shared token, Jira `X-Hub-Signature`, Linear `Linear-Signature` + timestamp), then the
   * same idempotent delivery record + targeted job as GitHub. Delivery ids are namespaced per
   * provider (`gl-…`, `jira-…`, `lin-…`); without one, the body hash is the idempotency key.
   */
  async receiveProvider(
    kind: 'gitlab' | 'jira' | 'linear',
    rawBody: unknown,
    headers: { event?: string; delivery?: string; signature?: string },
  ): Promise<WebhookAccepted> {
    const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.alloc(0);
    const provider = this.registry.get(PROVIDER_ENUM[kind]);
    if (!provider.verifyWebhook(body, headers.signature)) {
      throw new AppException('WEBHOOK_SIGNATURE_INVALID', 'Invalid webhook signature');
    }
    let payload: unknown;
    try {
      payload = JSON.parse(body.toString('utf8'));
    } catch {
      throw new AppException('VALIDATION_FAILED', 'Webhook body is not valid JSON');
    }
    const eventName =
      kind === 'jira' ? (payload as { webhookEvent?: unknown }).webhookEvent : headers.event;
    if (typeof eventName !== 'string' || !PROVIDER_EVENT_NAME.test(eventName)) {
      throw new AppException('VALIDATION_FAILED', 'Missing or invalid webhook event name');
    }
    const prefix = { gitlab: 'gl', jira: 'jira', linear: 'lin' }[kind];
    const rawId = headers.delivery?.replace(/[^A-Za-z0-9-]/g, '').slice(0, 80);
    const deliveryId = `${prefix}-${rawId || createHash('sha256').update(body).digest('hex').slice(0, 64)}`;

    const event = provider.parseWebhook(eventName, payload);
    const action =
      (payload as { action?: unknown; object_attributes?: { action?: unknown } }).object_attributes
        ?.action ?? (payload as { action?: unknown }).action;
    const inserted = await this.prisma.webhookDelivery.createMany({
      data: [
        {
          id: deliveryId,
          provider: PROVIDER_ENUM[kind],
          event: eventName.slice(0, 64),
          action: typeof action === 'string' ? action.slice(0, 64) : null,
          installationId: null,
          status: event.kind === 'ignored' ? WebhookStatus.IGNORED : WebhookStatus.RECEIVED,
          processedAt: event.kind === 'ignored' ? new Date() : null,
        },
      ],
      skipDuplicates: true,
    });
    if (inserted.count === 0) {
      this.logger.log({ deliveryId }, 'Duplicate webhook delivery ignored');
      return { accepted: true, duplicate: true };
    }
    if (event.kind !== 'ignored') {
      await this.queue.add(
        SYNC_JOBS.targeted,
        { deliveryId, event },
        {
          jobId: targetedJobId(deliveryId),
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: true,
          removeOnFail: { age: 7 * 86_400 },
        },
      );
    }
    return { accepted: true, duplicate: false };
  }
}
