import {
  generateAppraisalSchema,
  generatePromotionSchema,
  generateResumeSchema,
} from '@devimpact/shared';
import { Controller, Logger, Post } from '@nestjs/common';

import { type AuthUser, CurrentUser } from '../auth/auth.decorators';
import { AppException } from '../common/app-exception';
import { ApiDoc, ZodBody } from '../common/zod-validation';
import { RateLimit } from '../throttle/rate-limit';
import { GenerateService } from './generate.service';

import type { z } from 'zod';

type GenerateResumeInput = z.output<typeof generateResumeSchema>;
type GenerateAppraisalInput = z.output<typeof generateAppraisalSchema>;
type GeneratePromotionInput = z.output<typeof generatePromotionSchema>;

/**
 * v1 generation endpoints, kept until P08 (`POST /documents`) with validated inputs (BUG-07),
 * the `ai` rate-limit class (SEC-07) and safe upstream errors (SEC-12).
 */
@Controller('generate')
@RateLimit('ai')
export class GenerateController {
  private readonly logger = new Logger(GenerateController.name);

  constructor(private generateService: GenerateService) {}

  private async upstream<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof AppException) throw error;
      // Provider payloads and request ids stay in the logs only.
      this.logger.error({ err: error }, 'AI generation failed');
      throw new AppException(
        'UPSTREAM_ERROR',
        'The AI provider returned an error. Please try again.',
        {
          provider: 'anthropic',
        },
      );
    }
  }

  @Post('resume')
  @ApiDoc({
    summary: 'Generate resume bullets (transitional; P08: POST /documents)',
    tags: ['generate'],
    rateLimit: 'ai',
  })
  generateResume(
    @CurrentUser() user: AuthUser,
    @ZodBody(generateResumeSchema) body: GenerateResumeInput,
  ) {
    return this.upstream(() =>
      this.generateService.generateResume(user.id, body.dateRange, body.role),
    );
  }

  @Post('appraisal')
  @ApiDoc({
    summary: 'Generate an appraisal report (transitional)',
    tags: ['generate'],
    rateLimit: 'ai',
  })
  generateAppraisal(
    @CurrentUser() user: AuthUser,
    @ZodBody(generateAppraisalSchema) body: GenerateAppraisalInput,
  ) {
    return this.upstream(() =>
      this.generateService.generateAppraisal(user.id, body.period, body.month, body.year),
    );
  }

  @Post('promotion')
  @ApiDoc({
    summary: 'Generate a promotion packet (transitional)',
    tags: ['generate'],
    rateLimit: 'ai',
  })
  generatePromotion(
    @CurrentUser() user: AuthUser,
    @ZodBody(generatePromotionSchema) body: GeneratePromotionInput,
  ) {
    return this.upstream(() =>
      this.generateService.generatePromotion(user.id, body.currentRole, body.targetRole),
    );
  }
}
