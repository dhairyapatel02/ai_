import {
  AchievementStatementInput,
  AchievementStatementResponse,
  HighlightsInput,
  HighlightsResponse,
} from '@devimpact/shared';
import { Controller, HttpCode, Post, Res } from '@nestjs/common';

import { type AuthUser, CurrentUser } from '../auth/auth.decorators';
import { ApiDoc, ZodBody } from '../common/zod-validation';
import { RateLimit } from '../throttle/rate-limit';
import { QuickActionsService } from './quick-actions.service';

import type { Response } from 'express';

/** API_CONTRACT_V2 §10 — `POST /impact/highlights` (F-29). `GET /impact` stays AI-free. */
@Controller('impact')
export class ImpactHighlightsController {
  constructor(private readonly quick: QuickActionsService) {}

  @Post('highlights')
  @RateLimit('ai')
  @ApiDoc({
    summary:
      'AI narrative highlights for the period’s impact score (fast model, cached per score inputs; 200 cached / 201 new)',
    tags: ['impact'],
    rateLimit: 'ai',
    response: HighlightsResponse,
  })
  async highlights(
    @CurrentUser() user: AuthUser,
    @ZodBody(HighlightsInput) body: HighlightsInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { status, ...result } = await this.quick.highlights(user.id, body);
    res.status(status);
    return result;
  }
}

/** API_CONTRACT_V2 §14 — AI utilities (F-51). */
@Controller('ai')
@RateLimit('ai')
export class AiUtilitiesController {
  constructor(private readonly quick: QuickActionsService) {}

  @Post('achievement-statement')
  @HttpCode(200)
  @ApiDoc({
    summary: 'Achievement statement for one of your PRs or commits (fast model, cached)',
    tags: ['ai'],
    rateLimit: 'ai',
    response: AchievementStatementResponse,
  })
  achievementStatement(
    @CurrentUser() user: AuthUser,
    @ZodBody(AchievementStatementInput) body: AchievementStatementInput,
  ) {
    return this.quick.achievementStatement(user.id, body);
  }
}
