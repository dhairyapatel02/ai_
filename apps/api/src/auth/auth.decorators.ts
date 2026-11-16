import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';

import { AppException } from '../common/app-exception';

import type { Request } from 'express';

/** The authenticated principal derived from a verified JWT (ADR-0003). Nothing else is trusted. */
export interface AuthUser {
  id: string;
}

export type AuthenticatedRequest = Request & { user?: AuthUser };

export const IS_PUBLIC = 'devimpact:is-public';
/** Marks a route as reachable without a token (health, webhooks, unsubscribe). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** `@CurrentUser() user: AuthUser` — set by the global AuthGuard. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!req.user) throw AppException.unauthenticated();
  return req.user;
});
