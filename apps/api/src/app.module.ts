import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { SyncModule } from './sync/sync.module';
import { ActivityModule } from './activity/activity.module';
import { GenerateModule } from './generate/generate.module';
import { DocumentsModule } from './documents/documents.module';
import { AIModule } from './ai/ai.module';
import { GitHubModule } from './github/github.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    }),
    PrismaModule,
    AuthModule,
    IntegrationsModule,
    SyncModule,
    ActivityModule,
    GenerateModule,
    DocumentsModule,
    AIModule,
    GitHubModule,
  ],
})
export class AppModule {}
