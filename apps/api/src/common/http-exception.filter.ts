import { ERROR_STATUS, type ErrorCode, type ErrorEnvelope } from '@devimpact/shared';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';

import { AppException } from './app-exception';
import { requestIdOf } from './request-id';

import type { Request, Response } from 'express';

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  402: 'QUOTA_EXCEEDED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMITED',
  502: 'UPSTREAM_ERROR',
  503: 'UPSTREAM_UNAVAILABLE',
};

const SAFE_MESSAGES: Partial<Record<ErrorCode, string>> = {
  VALIDATION_FAILED: 'The request is invalid',
  UNAUTHENTICATED: 'Authentication required',
  FORBIDDEN: 'You are not allowed to do this',
  NOT_FOUND: 'Not found',
  CONFLICT: 'The request conflicts with the current state',
  PAYLOAD_TOO_LARGE: 'Request body is too large (max 256 KB)',
  RATE_LIMITED: 'Too many requests; slow down',
  INTERNAL: 'Something went wrong on our side',
  UPSTREAM_ERROR: 'An upstream service returned an error',
  UPSTREAM_UNAVAILABLE: 'An upstream service is unavailable',
};

export interface NormalizedError {
  status: number;
  code: ErrorCode;
  message: string;
  details?: unknown;
}

/**
 * Maps anything thrown into a safe, stable error (API_CONTRACT_V2 §2, SEC-12): AppException as
 * is; Nest HttpExceptions by status with generic messages (their text may echo internals);
 * body-parser errors by `type`; everything else → 500 INTERNAL. Details of unexpected errors are
 * only logged server-side.
 */
export function normalizeError(exception: unknown): NormalizedError {
  if (exception instanceof AppException) {
    return {
      status: exception.status,
      code: exception.code,
      message: exception.message,
      ...(exception.details === undefined ? {} : { details: exception.details }),
    };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const code = STATUS_TO_CODE[status] ?? (status >= 500 ? 'INTERNAL' : 'VALIDATION_FAILED');
    const message =
      status === 404 ? 'Route not found' : (SAFE_MESSAGES[code] ?? 'The request failed');
    return { status: status >= 500 && !(status in STATUS_TO_CODE) ? 500 : status, code, message };
  }
  const bodyParserType = (exception as { type?: unknown } | null)?.type;
  if (bodyParserType === 'entity.too.large') {
    return {
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Request body is too large (max 256 KB)',
    };
  }
  if (bodyParserType === 'entity.parse.failed') {
    return { status: 400, code: 'VALIDATION_FAILED', message: 'Malformed JSON body' };
  }
  if (typeof bodyParserType === 'string' && bodyParserType.startsWith('encoding.')) {
    return { status: 415, code: 'VALIDATION_FAILED', message: 'Unsupported content encoding' };
  }
  return {
    status: ERROR_STATUS.INTERNAL,
    code: 'INTERNAL',
    message: 'Something went wrong on our side',
  };
}

export function buildErrorEnvelope(error: NormalizedError, requestId: string): ErrorEnvelope {
  return {
    success: false,
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
      requestId,
    },
  };
}

/** Writes the error envelope; shared by the Nest filter and the body-parser wrapper. */
export function sendError(req: Request, res: Response, exception: unknown, logger?: Logger): void {
  const error = normalizeError(exception);
  const requestId = requestIdOf(req, res);
  if (error.status >= 500) {
    logger?.error(
      { err: exception, requestId, path: req.path },
      exception instanceof Error ? exception.message : 'Unhandled error',
    );
  }
  const details = error.details as { retryAfterSeconds?: number } | undefined;
  if (error.status === 429 && typeof details?.retryAfterSeconds === 'number') {
    res.setHeader('Retry-After', String(details.retryAfterSeconds));
  }
  if (!res.headersSent) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(error.status).json(buildErrorEnvelope(error, requestId));
  }
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;
    const http = host.switchToHttp();
    sendError(http.getRequest<Request>(), http.getResponse<Response>(), exception, this.logger);
  }
}
