import {
  AchievementDto,
  AchievementInput,
  AchievementListQuery,
  DeletedResponse,
  IdParams,
  UpdateAchievementInput,
  type AchievementInputParsed,
} from '@devimpact/shared';
import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { z } from 'zod';

import { type AuthUser, CurrentUser } from '../auth/auth.decorators';
import { withMeta } from '../common/envelope.interceptor';
import { ApiDoc, ZodBody, ZodParams, ZodQuery } from '../common/zod-validation';
import { AchievementsService } from './achievements.service';

/** API_CONTRACT_V2 §15 — achievements journal (F-60, F-61). */
@Controller('achievements')
export class AchievementsController {
  constructor(private readonly achievements: AchievementsService) {}

  @Get()
  @ApiDoc({
    summary: 'Achievements, newest first (filter by period, category, title search; total)',
    tags: ['achievements'],
    response: z.array(AchievementDto),
  })
  async list(
    @CurrentUser() user: AuthUser,
    @ZodQuery(AchievementListQuery) query: AchievementListQuery,
  ) {
    const page = await this.achievements.list(user.id, query);
    return withMeta(page.items, page.meta);
  }

  @Post()
  @ApiDoc({
    summary: 'Add an achievement (evidence must be your own PRs, commits or reviews)',
    tags: ['achievements'],
    status: 201,
    response: AchievementDto,
  })
  create(@CurrentUser() user: AuthUser, @ZodBody(AchievementInput) body: AchievementInputParsed) {
    return this.achievements.create(user.id, body);
  }

  @Get(':id')
  @ApiDoc({ summary: 'One achievement', tags: ['achievements'], response: AchievementDto })
  get(@CurrentUser() user: AuthUser, @ZodParams(IdParams) params: { id: string }) {
    return this.achievements.get(user.id, params.id);
  }

  @Patch(':id')
  @ApiDoc({ summary: 'Update an achievement', tags: ['achievements'], response: AchievementDto })
  update(
    @CurrentUser() user: AuthUser,
    @ZodParams(IdParams) params: { id: string },
    @ZodBody(UpdateAchievementInput) body: UpdateAchievementInput,
  ) {
    return this.achievements.update(user.id, params.id, body);
  }

  @Delete(':id')
  @ApiDoc({ summary: 'Delete an achievement', tags: ['achievements'], response: DeletedResponse })
  remove(@CurrentUser() user: AuthUser, @ZodParams(IdParams) params: { id: string }) {
    return this.achievements.remove(user.id, params.id);
  }
}
