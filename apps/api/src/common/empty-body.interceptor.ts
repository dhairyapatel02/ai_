import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import type { Observable } from 'rxjs';

/**
 * Express 5 (NestJS 11) leaves `req.body` undefined when no body parser matched (e.g. a
 * text/plain or empty request); Express 4 defaulted it to `{}`. v0.1 handlers read fields from
 * `@Body()` directly, so restore the old default to keep their behaviour unchanged until Zod
 * request validation replaces this in P05 (API-02).
 */
export class EmptyBodyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') {
      const request = context.switchToHttp().getRequest<Request>();
      request.body ??= {};
    }
    return next.handle();
  }
}
