import { Controller, Get } from '@nestjs/common';
import { z } from 'zod';

import { Public } from '../auth/auth.decorators';
import { AppException } from '../common/app-exception';
import { ApiDoc } from '../common/zod-validation';
import { HealthService } from './health.service';

const startedAt = Date.now();
const VERSION = process.env.npm_package_version ?? '2.0.0-dev';

@Controller('health')
@Public()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /** Readiness: 200 when Postgres and Redis respond, 503 otherwise (compose healthchecks). */
  @Get()
  @ApiDoc({
    summary: 'Readiness (database + Redis)',
    tags: ['health'],
    response: z.object({
      status: z.literal('ok'),
      checks: z.object({ database: z.enum(['ok', 'fail']), redis: z.enum(['ok', 'fail']) }),
    }),
  })
  async check() {
    const report = await this.healthService.check();
    if (report.status !== 'ok') {
      throw new AppException('UPSTREAM_UNAVAILABLE', 'A dependency is unavailable', report);
    }
    return report;
  }

  /** Liveness: no dependencies. */
  @Get('live')
  @ApiDoc({
    summary: 'Liveness (no dependencies)',
    tags: ['health'],
    response: z.object({ status: z.literal('ok'), version: z.string(), uptimeSeconds: z.number() }),
  })
  live() {
    return {
      status: 'ok' as const,
      version: VERSION,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    };
  }
}
