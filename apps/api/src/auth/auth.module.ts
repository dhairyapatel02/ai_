import { Module } from '@nestjs/common';

import { AuthGuard } from './auth.guard';
import { JwtVerifierService } from './jwt-verifier.service';

/**
 * API-side authentication (ADR-0003): the guard (registered globally in AppModule) that verifies Better Auth JWTs via JWKS.
 * Sign-in, sessions and dev login live in the web app; the v0.1 `/auth/dev-login`,
 * `/auth/github` and `/auth/google` endpoints are removed (SEC-02, API-03).
 */
@Module({
  providers: [JwtVerifierService, AuthGuard],
  exports: [JwtVerifierService, AuthGuard],
})
export class AuthModule {}
