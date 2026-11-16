import { Module } from '@nestjs/common';

import { IntegrationsModule } from '../integrations/integrations.module';
import { AuthMeAliasController, MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  imports: [IntegrationsModule],
  controllers: [MeController, AuthMeAliasController],
  providers: [MeService],
  exports: [MeService],
})
export class MeModule {}
