import { Module } from '@nestjs/common';

import { IntegrationsModule } from '../integrations/integrations.module';
import { MetricsCoreModule } from '../metrics/metrics-core.module';
import { UsageModule } from '../usage/usage.module';
import { AuthMeAliasController, MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  imports: [IntegrationsModule, MetricsCoreModule, UsageModule],
  controllers: [MeController, AuthMeAliasController],
  providers: [MeService],
  exports: [MeService],
})
export class MeModule {}
