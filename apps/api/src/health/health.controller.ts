import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';

import { successResponse } from '../common/api-response';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /** Liveness + readiness: 200 when Postgres and Redis respond, 503 otherwise. */
  @Get()
  async check() {
    const report = await this.healthService.check();
    if (report.status !== 'ok') {
      throw new ServiceUnavailableException({
        success: false,
        error: 'Service unavailable',
        data: report,
      });
    }
    return successResponse(report);
  }
}
