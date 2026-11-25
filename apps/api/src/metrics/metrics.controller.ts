import {
  CareerTimelineQuery,
  CareerTimelineResponse,
  DefinitionsResponse,
  EvidenceItem,
  EvidenceQuery,
  HeatmapQuery,
  HeatmapResponse,
  ImpactDto,
  ImpactHistoryQuery,
  ImpactHistoryResponse,
  KpisResponse,
  OverviewResponse,
  PeriodQuery,
  ProviderBreakdownResponse,
  ReposQuery,
  ReposResponse,
  TimeseriesQuery,
  TimeseriesResponse,
  TrendsQuery,
  TrendsResponse,
} from '@devimpact/shared';
import { Controller, Get, Res } from '@nestjs/common';
import { z } from 'zod';

import { type AuthUser, CurrentUser } from '../auth/auth.decorators';
import { withMeta } from '../common/envelope.interceptor';
import { ApiDoc, ZodQuery } from '../common/zod-validation';
import { CareerService } from './career.service';
import { MetricsService } from './metrics.service';

import type { Response } from 'express';

/**
 * API_CONTRACT_V2 §9 + A-1/A-2 — read-only KPI endpoints. They never call the AI and never
 * enqueue work (ADR-0008); a period's metrics are computed lazily and cached in `ImpactScore`.
 */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('definitions')
  @ApiDoc({
    summary: 'Metric catalogue (metrics@2.0.0), score version and bands',
    tags: ['metrics'],
    response: DefinitionsResponse,
  })
  definitions(@Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return this.metrics.definitions();
  }

  @Get('overview')
  @ApiDoc({
    summary: 'Dashboard stat cards with deltas, impact summary and data freshness',
    tags: ['metrics'],
    response: OverviewResponse,
  })
  overview(@CurrentUser() user: AuthUser, @ZodQuery(PeriodQuery) query: PeriodQuery) {
    return this.metrics.overview(user.id, query.period);
  }

  @Get('kpis')
  @ApiDoc({
    summary: 'The five KPI sections with values, deltas and evidence ids',
    tags: ['metrics'],
    response: KpisResponse,
  })
  kpis(@CurrentUser() user: AuthUser, @ZodQuery(PeriodQuery) query: PeriodQuery) {
    return this.metrics.kpis(user.id, query.period);
  }

  @Get('timeseries')
  @ApiDoc({
    summary: 'One metric per day/week/month bucket (≤ 400 points)',
    tags: ['metrics'],
    response: TimeseriesResponse,
  })
  timeseries(@CurrentUser() user: AuthUser, @ZodQuery(TimeseriesQuery) query: TimeseriesQuery) {
    return this.metrics.timeseries(user.id, query);
  }

  @Get('heatmap')
  @ApiDoc({
    summary: 'Daily activity counts (≤ 366 days, default the last 365)',
    tags: ['metrics'],
    response: HeatmapResponse,
  })
  heatmap(@CurrentUser() user: AuthUser, @ZodQuery(HeatmapQuery) query: HeatmapQuery) {
    return this.metrics.heatmap(user.id, query);
  }

  @Get('repos')
  @ApiDoc({
    summary: 'Contributions per repository in the period',
    tags: ['metrics'],
    response: ReposResponse,
  })
  repos(@CurrentUser() user: AuthUser, @ZodQuery(ReposQuery) query: ReposQuery) {
    return this.metrics.repos(user.id, query);
  }

  @Get('providers')
  @ApiDoc({
    summary: 'Per-provider totals in the period from the daily rollups (P13, A-8)',
    tags: ['metrics'],
    response: ProviderBreakdownResponse,
  })
  providers(@CurrentUser() user: AuthUser, @ZodQuery(PeriodQuery) query: PeriodQuery) {
    return this.metrics.providers(user.id, query.period);
  }

  @Get('trends')
  @ApiDoc({
    summary: 'Metric values for the last N periods of the same type (A-1)',
    tags: ['metrics'],
    response: TrendsResponse,
  })
  trends(@CurrentUser() user: AuthUser, @ZodQuery(TrendsQuery) query: TrendsQuery) {
    return this.metrics.trends(user.id, query);
  }

  @Get('evidence')
  @ApiDoc({
    summary: 'Records behind a metric value, newest first (A-2)',
    tags: ['metrics'],
    response: z.array(EvidenceItem),
  })
  async evidence(@CurrentUser() user: AuthUser, @ZodQuery(EvidenceQuery) query: EvidenceQuery) {
    const page = await this.metrics.evidence(
      user.id,
      query.metric,
      query.period,
      query.cursor,
      query.limit,
    );
    return withMeta(page.items, page.meta);
  }
}

/** API_CONTRACT_V2 §10 — deterministic impact score `impact@2.0.0` (F-28). */
@Controller('impact')
export class ImpactController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @ApiDoc({
    summary: 'Impact score, dimensions, explanation and stored inputs (lazy, cached)',
    tags: ['impact'],
    response: ImpactDto,
  })
  impact(@CurrentUser() user: AuthUser, @ZodQuery(PeriodQuery) query: PeriodQuery) {
    return this.metrics.impact(user.id, query.period);
  }

  @Get('history')
  @ApiDoc({
    summary: 'Impact score per month or quarter',
    tags: ['impact'],
    response: ImpactHistoryResponse,
  })
  history(@CurrentUser() user: AuthUser, @ZodQuery(ImpactHistoryQuery) query: ImpactHistoryQuery) {
    return this.metrics.impactHistory(user.id, query);
  }
}

/** API_CONTRACT_V2 §12 — career timeline (F-30). */
@Controller('career')
export class CareerController {
  constructor(private readonly career: CareerService) {}

  @Get('timeline')
  @ApiDoc({
    summary: 'The year by quarter: merged PRs, review clusters, milestones',
    tags: ['career'],
    response: CareerTimelineResponse,
  })
  timeline(
    @CurrentUser() user: AuthUser,
    @ZodQuery(CareerTimelineQuery) query: CareerTimelineQuery,
  ) {
    return this.career.timeline(user.id, query.year);
  }
}
