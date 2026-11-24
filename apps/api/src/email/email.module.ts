import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AiGenerationModule } from '../documents/documents.module';
import { MetricsCoreModule } from '../metrics/metrics-core.module';
import { DigestBuilder } from './digest-builder.service';
import { DigestScheduler } from './digest-scheduler.service';
import { DigestService } from './digest.service';
import { EMAIL_TRANSPORT } from './email.constants';
import { EmailProcessor } from './email.processor';
import { NotificationsController } from './notifications.controller';
import { createEmailTransport } from './transports';

import type { Env } from '../config/env';

/** Email transport (env-selected) + the deterministic digest builder. */
@Module({
  imports: [MetricsCoreModule],
  providers: [
    DigestBuilder,
    {
      provide: EMAIL_TRANSPORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        createEmailTransport({
          EMAIL_TRANSPORT: config.get('EMAIL_TRANSPORT', { infer: true }),
          SMTP_URL: config.get('SMTP_URL', { infer: true }),
          RESEND_API_KEY: config.get('RESEND_API_KEY', { infer: true }),
          RESEND_API_URL: config.get('RESEND_API_URL', { infer: true }),
        } as Env),
    },
  ],
  exports: [DigestBuilder, EMAIL_TRANSPORT],
})
export class EmailCoreModule {}

/** HTTP: public unsubscribe + digest preview (API_CONTRACT_V2 §17). */
@Module({
  imports: [EmailCoreModule],
  controllers: [NotificationsController],
})
export class NotificationsModule {}

/** `email` queue consumer + hourly digest fan-out (worker, or the API with RUN_WORKER_IN_API). */
@Module({
  imports: [EmailCoreModule, AiGenerationModule],
  providers: [DigestService, DigestScheduler, EmailProcessor],
  exports: [DigestService, DigestScheduler],
})
export class EmailWorkerModule {}
