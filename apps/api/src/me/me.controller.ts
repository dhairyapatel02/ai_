import {
  DeleteMeInput,
  Entitlements,
  MeDto,
  SettingsDto,
  UpdateMeInput,
  UpdateSettingsInput,
  UsageQuery,
  UsageResponse,
  UserDto,
} from '@devimpact/shared';
import { Controller, Delete, Get, HttpCode, Patch } from '@nestjs/common';
import { z } from 'zod';

import { type AuthUser, CurrentUser } from '../auth/auth.decorators';
import { withMeta } from '../common/envelope.interceptor';
import { ApiDoc, ZodBody, ZodQuery } from '../common/zod-validation';
import { RateLimit } from '../throttle/rate-limit';
import { UsageService } from '../usage/usage.service';
import { MeService } from './me.service';

@Controller('me')
export class MeController {
  constructor(
    private readonly me: MeService,
    private readonly usageService: UsageService,
  ) {}

  @Get('usage')
  @ApiDoc({
    summary: 'AI usage vs monthly plan quota (UTC month; default current)',
    tags: ['me'],
    response: UsageResponse,
  })
  usage(@CurrentUser() user: AuthUser, @ZodQuery(UsageQuery) query: UsageQuery) {
    return this.usageService.usage(user.id, query.month);
  }

  @Get()
  @ApiDoc({
    summary: 'Current user, settings, entitlements, integrations, onboarding',
    tags: ['me'],
    response: MeDto,
  })
  get(@CurrentUser() user: AuthUser) {
    return this.me.me(user.id);
  }

  @Patch()
  @ApiDoc({ summary: 'Update profile', tags: ['me'], response: z.object({ user: UserDto }) })
  update(@CurrentUser() user: AuthUser, @ZodBody(UpdateMeInput) body: UpdateMeInput) {
    return this.me.updateMe(user.id, body.name);
  }

  @Get('settings')
  @ApiDoc({ summary: 'User settings', tags: ['me'], response: SettingsDto })
  settings(@CurrentUser() user: AuthUser) {
    return this.me.settings(user.id);
  }

  @Patch('settings')
  @ApiDoc({
    summary:
      'Update user settings (timezone validated against IANA names; a change queues a full metrics recompute, meta.recomputeQueued)',
    tags: ['me'],
    response: SettingsDto,
  })
  async updateSettings(
    @CurrentUser() user: AuthUser,
    @ZodBody(UpdateSettingsInput) body: UpdateSettingsInput,
  ) {
    const { settings, recomputeQueued } = await this.me.updateSettings(user.id, body);
    return withMeta(settings, { recomputeQueued });
  }

  @Get('entitlements')
  @ApiDoc({ summary: 'Plan limits and usage', tags: ['me'], response: Entitlements })
  entitlements(@CurrentUser() user: AuthUser) {
    return this.me.entitlements(user.id);
  }

  @Delete()
  @HttpCode(202)
  @RateLimit('destructive')
  @ApiDoc({
    summary: 'Delete the account and all its data (confirm with the account email)',
    tags: ['me'],
    status: 202,
    rateLimit: 'destructive',
    response: z.object({ deleted: z.literal(true) }),
  })
  remove(@CurrentUser() user: AuthUser, @ZodBody(DeleteMeInput) body: DeleteMeInput) {
    return this.me.deleteAccount(user.id, body.confirmEmail);
  }
}
