'use client';

import {
  CareerTimelineResponse,
  DefinitionsResponse,
  HeatmapResponse,
  ImpactDto,
  KpisResponse,
  OverviewResponse,
  ReposResponse,
} from '@devimpact/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { apiClient } from './browser';
import { qk } from './query-keys';

/**
 * Metrics / impact / career queries (API_CONTRACT_V2 §9–§12). `period` is the explicit `?period=`
 * spec or undefined (API default). Previous data stays visible while the period changes
 * (`placeholderData`, DESIGN_SYSTEM §9 Loading).
 */
export function useOverview(period: string | undefined) {
  return useQuery({
    queryKey: qk.metrics.overview(period),
    queryFn: ({ signal }) =>
      apiClient.get('/metrics/overview', { schema: OverviewResponse, query: { period }, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useKpis(period: string | undefined) {
  return useQuery({
    queryKey: qk.metrics.kpis(period),
    queryFn: ({ signal }) =>
      apiClient.get('/metrics/kpis', { schema: KpisResponse, query: { period }, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useMetricsRepos(period: string | undefined, limit = 5) {
  return useQuery({
    queryKey: qk.metrics.repos(period, limit),
    queryFn: ({ signal }) =>
      apiClient.get('/metrics/repos', { schema: ReposResponse, query: { period, limit }, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useDefinitions() {
  return useQuery({
    queryKey: qk.metrics.definitions(),
    queryFn: ({ signal }) =>
      apiClient.get('/metrics/definitions', { schema: DefinitionsResponse, signal }),
    staleTime: 60 * 60 * 1000,
  });
}

export function useHeatmap(from?: string, to?: string) {
  return useQuery({
    queryKey: qk.metrics.heatmap(from, to),
    queryFn: ({ signal }) =>
      apiClient.get('/metrics/heatmap', { schema: HeatmapResponse, query: { from, to }, signal }),
  });
}

export function useImpact(period: string | undefined) {
  return useQuery({
    queryKey: qk.impact.detail(period),
    queryFn: ({ signal }) =>
      apiClient.get('/impact', { schema: ImpactDto, query: { period }, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useCareerTimeline(year?: number) {
  return useQuery({
    queryKey: qk.career.timeline(year),
    queryFn: ({ signal }) =>
      apiClient.get('/career/timeline', {
        schema: CareerTimelineResponse,
        query: { year },
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}
