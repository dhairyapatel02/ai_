import {
  DeletedResponse,
  GoalDetailDto,
  GoalDto,
  GoalInput,
  GoalListQuery,
  IdParams,
  UpdateGoalInput,
  type GoalInputParsed,
} from '@devimpact/shared';
import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { z } from 'zod';

import { type AuthUser, CurrentUser } from '../auth/auth.decorators';
import { withMeta } from '../common/envelope.interceptor';
import { ApiDoc, ZodBody, ZodParams, ZodQuery } from '../common/zod-validation';
import { GoalsService } from './goals.service';

/** API_CONTRACT_V2 §16 — goals with optional metric targets (F-62). */
@Controller('goals')
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @Get()
  @ApiDoc({
    summary: 'Goals with progress from the metrics engine (filter by status; total)',
    tags: ['goals'],
    response: z.array(GoalDto),
  })
  async list(@CurrentUser() user: AuthUser, @ZodQuery(GoalListQuery) query: GoalListQuery) {
    const page = await this.goals.list(user.id, query);
    return withMeta(page.items, page.meta);
  }

  @Post()
  @ApiDoc({ summary: 'Add a goal', tags: ['goals'], status: 201, response: GoalDto })
  create(@CurrentUser() user: AuthUser, @ZodBody(GoalInput) body: GoalInputParsed) {
    return this.goals.create(user.id, body);
  }

  @Get(':id')
  @ApiDoc({
    summary: 'A goal with its linked achievements',
    tags: ['goals'],
    response: GoalDetailDto,
  })
  get(@CurrentUser() user: AuthUser, @ZodParams(IdParams) params: { id: string }) {
    return this.goals.get(user.id, params.id);
  }

  @Patch(':id')
  @ApiDoc({ summary: 'Update a goal', tags: ['goals'], response: GoalDto })
  update(
    @CurrentUser() user: AuthUser,
    @ZodParams(IdParams) params: { id: string },
    @ZodBody(UpdateGoalInput) body: UpdateGoalInput,
  ) {
    return this.goals.update(user.id, params.id, body);
  }

  @Delete(':id')
  @ApiDoc({ summary: 'Delete a goal', tags: ['goals'], response: DeletedResponse })
  remove(@CurrentUser() user: AuthUser, @ZodParams(IdParams) params: { id: string }) {
    return this.goals.remove(user.id, params.id);
  }
}
