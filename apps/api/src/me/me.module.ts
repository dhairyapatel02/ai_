import { Module } from '@nestjs/common';

import { AiCoreModule } from '../ai/ai.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { MetricsCoreModule } from '../metrics/metrics-core.module';
import { UsageModule } from '../usage/usage.module';
import { DataExportService } from './data-export.service';
import { MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  imports: [IntegrationsModule, MetricsCoreModule, UsageModule, AiCoreModule],
  controllers: [MeController],
  providers: [MeService, DataExportService],
  exports: [MeService],
})
export class MeModule {}
