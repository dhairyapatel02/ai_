import { Module } from '@nestjs/common';

import { AiCoreModule } from '../ai/ai.module';
import { NotificationProducer } from '../email/notification-producer';
import { EvidenceModule } from '../evidence/evidence.module';
import { DocumentExportsService } from '../exports/document-exports.service';
import { UsageModule } from '../usage/usage.module';
import { AiUtilitiesController, ImpactHighlightsController } from './ai-actions.controller';
import { DigestSummaryService } from './digest-summary.service';
import { DocumentGenerationService } from './document-generation.service';
import { DocumentInputs } from './document-inputs.service';
import { DocumentStreamService } from './document-stream.service';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { QuickActionsService } from './quick-actions.service';

/** Generation services shared by the API (tests) and the worker. */
@Module({
  imports: [AiCoreModule, EvidenceModule, UsageModule],
  providers: [
    DocumentInputs,
    DocumentGenerationService,
    DigestSummaryService,
    NotificationProducer,
  ],
  exports: [
    DocumentInputs,
    DocumentGenerationService,
    DigestSummaryService,
    AiCoreModule,
    EvidenceModule,
    UsageModule,
  ],
})
export class AiGenerationModule {}

/** HTTP API: documents, impact highlights, AI utilities (API_CONTRACT_V2 §10, §13, §14). */
@Module({
  imports: [AiGenerationModule],
  controllers: [DocumentsController, ImpactHighlightsController, AiUtilitiesController],
  providers: [DocumentsService, DocumentStreamService, QuickActionsService, DocumentExportsService],
})
export class DocumentsModule {}
