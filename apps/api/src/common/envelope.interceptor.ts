import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  SetMetadata,
  StreamableFile,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, type Observable } from 'rxjs';

import type { Response } from 'express';

/** A handler result that carries `meta` (pagination, flags) next to `data`. */
export class WithMeta<T> {
  constructor(
    readonly data: T,
    readonly meta: Record<string, unknown>,
  ) {}
}

export const withMeta = <T>(data: T, meta: Record<string, unknown>) => new WithMeta(data, meta);

export const RAW_RESPONSE = 'devimpact:raw-response';
/** Opt a handler out of the envelope (files, SSE, swagger). */
export const RawResponse = () => SetMetadata(RAW_RESPONSE, true);

/**
 * Wraps every successful handler result in `{ success: true, data, meta? }` (D-006) and marks
 * authenticated responses as non-cacheable (API_CONTRACT_V2 §1).
 */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const raw = this.reflector.getAllAndOverride<boolean | undefined>(RAW_RESPONSE, [
      context.getHandler(),
      context.getClass(),
    ]);
    const res = context.switchToHttp().getResponse<Response>();
    if (!res.getHeader('Cache-Control')) res.setHeader('Cache-Control', 'private, no-store');
    if (raw) return next.handle();

    return next.handle().pipe(
      map((value: unknown) => {
        if (value instanceof StreamableFile) return value;
        if (value instanceof WithMeta) {
          return { success: true, data: value.data as unknown, meta: value.meta };
        }
        return { success: true, data: value ?? null };
      }),
    );
  }
}
