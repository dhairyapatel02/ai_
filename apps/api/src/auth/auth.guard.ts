import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AppException } from '../common/app-exception';
import { type AuthenticatedRequest, IS_PUBLIC } from './auth.decorators';
import { JwtVerifierService } from './jwt-verifier.service';

/**
 * Global guard: every route requires `Authorization: Bearer <JWT>` unless marked `@Public()`.
 * The user id comes only from the verified token's `sub` (SEC-01: no client-supplied user-id header).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: JwtVerifierService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer ([A-Za-z0-9._~+/=-]+)$/.exec(header) : null;
    if (!match?.[1]) throw AppException.unauthenticated();

    req.user = await this.verifier.verify(match[1]);
    return true;
  }
}
