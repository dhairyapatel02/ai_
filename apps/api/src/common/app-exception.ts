import { ERROR_STATUS, type ErrorCode } from '@devimpact/shared';

/**
 * The one exception type services throw for expected failures. The global exception filter turns
 * it into the D-006 error envelope with the code's HTTP status (API_CONTRACT_V2 §2).
 * `message` must be safe to show to users: no stack traces, SQL, paths or provider payloads.
 */
export class AppException extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    status?: number,
  ) {
    super(message);
    this.name = 'AppException';
    this.status = status ?? ERROR_STATUS[code];
  }

  static notFound(what = 'Resource'): AppException {
    return new AppException('NOT_FOUND', `${what} not found`);
  }

  static unauthenticated(message = 'Authentication required'): AppException {
    return new AppException('UNAUTHENTICATED', message);
  }
}
