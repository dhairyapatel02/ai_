import { Injectable } from '@nestjs/common';
import { IntegrationStatus, PeriodType, type Prisma, type UserSettings } from '@prisma/client';

import { AppException } from '../common/app-exception';
import { limitsFor } from '../entitlements/entitlements';
import { toIntegrationSummary } from '../integrations/integration.mapper';
import { IntegrationsService } from '../integrations/integrations.service';
import { PrismaService } from '../prisma/prisma.service';

import type {
  Entitlements,
  MeDto,
  PeriodTypeWire,
  PlanWire,
  SettingsDto,
  UpdateSettingsInput,
  UserDto,
} from '@devimpact/shared';

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  image: true,
  plan: true,
  createdAt: true,
} as const;
type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

function toUserDto(user: UserRow): UserDto {
  let image: string | null = null;
  try {
    image = user.image && new URL(user.image).protocol === 'https:' ? user.image : null;
  } catch {
    image = null;
  }
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image,
    plan: user.plan.toLowerCase() as PlanWire,
    createdAt: user.createdAt.toISOString(),
  };
}

function toSettingsDto(s: UserSettings): SettingsDto {
  return {
    timezone: s.timezone,
    currentRole: s.currentRole,
    careerLevel: s.careerLevel,
    targetRole: s.targetRole,
    defaultPeriodType: (s.defaultPeriodType === PeriodType.CUSTOM
      ? 'month'
      : s.defaultPeriodType.toLowerCase()) as PeriodTypeWire,
    digestEnabled: s.digestEnabled,
    digestDayOfWeek: s.digestDayOfWeek,
    digestHourLocal: s.digestHourLocal,
    notifySyncFailures: s.notifySyncFailures,
    notifyDocumentReady: s.notifyDocumentReady,
    aiRedactPrivateRepos: s.aiRedactPrivateRepos,
    onboardingStep: s.onboardingStep,
    onboardingCompletedAt: s.onboardingCompletedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
  ) {}

  /** A valid JWT for a deleted account must not keep working (tokens live ≤ 15 min). */
  private async user(userId: string): Promise<UserRow> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: USER_SELECT });
    if (!user) throw AppException.unauthenticated('Account not found');
    return user;
  }

  /** Settings rows are created lazily for users created by Better Auth. */
  async settingsRow(userId: string): Promise<UserSettings> {
    return this.prisma.userSettings.upsert({ where: { userId }, update: {}, create: { userId } });
  }

  async me(userId: string): Promise<MeDto> {
    const user = await this.user(userId);
    const [settings, integrations] = await Promise.all([
      this.settingsRow(userId),
      this.prisma.integration.findMany({
        where: { userId },
        select: { id: true, status: true, externalLogin: true, lastSuccessfulSyncAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return {
      user: toUserDto(user),
      settings: toSettingsDto(settings),
      entitlements: this.entitlementsFor(user, integrations),
      integrations: integrations.map(toIntegrationSummary),
      onboarding: {
        step: settings.onboardingStep,
        completed: settings.onboardingCompletedAt !== null,
      },
    };
  }

  async updateMe(userId: string, name: string): Promise<{ user: UserDto }> {
    await this.user(userId);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { name },
      select: USER_SELECT,
    });
    return { user: toUserDto(user) };
  }

  async settings(userId: string): Promise<SettingsDto> {
    await this.user(userId);
    return toSettingsDto(await this.settingsRow(userId));
  }

  async updateSettings(userId: string, input: UpdateSettingsInput): Promise<SettingsDto> {
    await this.user(userId);
    const { onboardingCompleted, defaultPeriodType, ...rest } = input;
    const data: Prisma.UserSettingsUpdateInput = {
      ...rest,
      ...(defaultPeriodType
        ? { defaultPeriodType: defaultPeriodType.toUpperCase() as PeriodType }
        : {}),
      ...(onboardingCompleted === undefined
        ? {}
        : { onboardingCompletedAt: onboardingCompleted ? new Date() : null }),
    };
    const row = await this.prisma.userSettings.upsert({
      where: { userId },
      update: data,
      create: { userId, ...(data as Omit<Prisma.UserSettingsUncheckedCreateInput, 'userId'>) },
    });
    // A timezone change triggers a full metrics recompute once the metrics engine exists (P07).
    return toSettingsDto(row);
  }

  async entitlements(userId: string): Promise<Entitlements> {
    const user = await this.user(userId);
    const integrations = await this.prisma.integration.findMany({
      where: { userId },
      select: { status: true },
    });
    return this.entitlementsFor(user, integrations);
  }

  private entitlementsFor(
    user: UserRow,
    integrations: { status: IntegrationStatus }[],
  ): Entitlements {
    return {
      plan: user.plan.toLowerCase() as PlanWire,
      limits: limitsFor(user.plan),
      usage: {
        integrations: integrations.filter((i) => i.status !== IntegrationStatus.DISCONNECTED)
          .length,
      },
    };
  }

  /**
   * `DELETE /me` (F-03): the typed email must match; GitHub tokens are revoked (best effort),
   * then the user row is deleted and every user-owned row cascades (sessions and accounts too).
   */
  async deleteAccount(userId: string, confirmEmail: string): Promise<{ deleted: true }> {
    const user = await this.user(userId);
    if (user.email.toLowerCase() !== confirmEmail.trim().toLowerCase()) {
      throw new AppException('VALIDATION_FAILED', 'The email does not match your account', {
        issues: [
          {
            path: 'body.confirmEmail',
            message: 'Does not match the account email',
            code: 'mismatch',
          },
        ],
      });
    }
    await this.integrations.revokeAllTokens(userId);
    await this.prisma.user.delete({ where: { id: userId } });
    return { deleted: true };
  }
}
