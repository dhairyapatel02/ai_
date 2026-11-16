import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';

import { genRequestId } from '../common/request-id';

import type { AuthenticatedRequest } from '../auth/auth.decorators';
import type { Env } from '../config/env';
import type { IncomingMessage } from 'node:http';
import type { DestinationStream } from 'pino';

/**
 * Paths never written to logs (ARCHITECTURE_V2 §10). Matching is on the logged object, so these
 * cover request headers, error objects and anything a service logs with these keys.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.authorization',
  '*.cookie',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.access_token',
  '*.refresh_token',
  '*.accessTokenEnc',
  '*.refreshTokenEnc',
  '*.password',
  '*.code',
  '*.state',
  '*.codeVerifier',
  '*.clientSecret',
  '*.client_secret',
  '*.privateKey',
  'ANTHROPIC_API_KEY',
  '*.ANTHROPIC_API_KEY',
  '*.GITHUB_APP_CLIENT_SECRET',
  '*.GITHUB_APP_PRIVATE_KEY',
  '*.GITHUB_WEBHOOK_SECRET',
  '*.TOKEN_ENCRYPTION_KEYS',
  '*.OAUTH_STATE_SECRET',
];

export interface LoggingOptions {
  /** Test hook: write log lines here instead of stdout. */
  stream?: DestinationStream;
}

/** Structured JSON logs with request id, user id and latency (nestjs-pino). */
export function loggerModule(options: LoggingOptions = {}) {
  return LoggerModule.forRootAsync({
    inject: [ConfigService],
    useFactory: (config: ConfigService<Env, true>) => {
      const level = options.stream ? 'info' : config.get('LOG_LEVEL', { infer: true });
      const httpOptions = {
        level,
        genReqId: genRequestId,
        redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
        customProps: (req: IncomingMessage) => {
          const user = (req as AuthenticatedRequest).user;
          return user ? { userId: user.id } : {};
        },
        serializers: {
          req: (req: {
            id: unknown;
            method: string;
            url: string;
            headers: Record<string, unknown>;
          }) => ({
            id: req.id,
            method: req.method,
            // Query strings are dropped: they can carry cursors or search text.
            url: req.url.split('?')[0],
            headers: req.headers,
          }),
        },
        autoLogging: {
          ignore: (req: IncomingMessage) => (req.url ?? '').startsWith('/api/health'),
        },
        customLogLevel: (_req: IncomingMessage, res: { statusCode: number }, err?: Error) =>
          err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      } as const;
      return { pinoHttp: options.stream ? [httpOptions, options.stream] : httpOptions };
    },
  });
}
