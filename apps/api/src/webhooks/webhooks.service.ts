import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Provider, WebhookStatus } from '@prisma/client';
import { Queue } from 'bullmq';

import { AppException } from '../common/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import { ACTIVITY_PROVIDER } from '../providers/providers.module';
import { SYNC_JOBS, SYNC_QUEUE, targetedJobId } from '../sync/sync.constants';

import type { ActivityProvider, ProviderWebhookEvent, WebhookAccepted } from '@devimpact/shared';

export interface TargetedJobData {
  deliveryId: string;
  event: ProviderWebhookEvent;
}

const DELIVERY_ID = /^[A-Za-z0-9-]{1,100}$/;
const EVENT_NAME = /^[a-z_]{1,64}$/;

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
}
