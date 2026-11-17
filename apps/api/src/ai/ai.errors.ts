/**
 * Typed AI failures (ADR-0009). `retryable` drives the client's retry loop and the SSE `error`
 * event; `code` is what the API/SSE layer reports. Provider payloads never reach `message`.
 */
export type AiErrorKind =
  | 'not_configured' // no ANTHROPIC_API_KEY
  | 'rate_limited' // 429
  | 'overloaded' // 529 / overloaded_error
  | 'unavailable' // 5xx, connection error, timeout
  | 'refused' // stop_reason refusal (after the server-side fallback, if enabled)
  | 'truncated' // stop_reason max_tokens
  | 'output_invalid' // schema validation failed after one repair
  | 'bad_request' // 400/401/403/404/413/422: terminal, a bug or misconfiguration
  | 'aborted'; // cancelled by the user / AbortSignal

const RETRYABLE: ReadonlySet<AiErrorKind> = new Set(['rate_limited', 'overloaded', 'unavailable']);

export class AiError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly kind: AiErrorKind,
    message: string,
    readonly options: { status?: number; retryAfterSeconds?: number; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'AiError';
    this.retryable = RETRYABLE.has(kind);
  }

  /** Code reported on the SSE `error` event / stored as `GeneratedDocument.errorCode`. */
  get code(): string {
    switch (this.kind) {
      case 'output_invalid':
      case 'truncated':
        return 'OUTPUT_INVALID';
      case 'rate_limited':
      case 'overloaded':
      case 'unavailable':
      case 'not_configured':
        return 'UPSTREAM_UNAVAILABLE';
      case 'bad_request':
        return 'UPSTREAM_ERROR';
      case 'aborted':
        return 'CANCELLED';
      case 'refused':
        return 'GENERATION_FAILED';
    }
  }

  /** User-safe message (S16 copy: nothing was counted against the quota). */
  get userMessage(): string {
    switch (this.kind) {
      case 'not_configured':
        return 'AI generation is not configured on this server.';
      case 'rate_limited':
      case 'overloaded':
      case 'unavailable':
        return 'The AI service is busy. Try again in a minute.';
      case 'refused':
        return 'The AI model declined to write this document. Try different options.';
      case 'truncated':
      case 'output_invalid':
        return 'The AI response could not be turned into a valid document. Try again.';
      case 'bad_request':
        return 'The AI provider returned an error. Try again later.';
      case 'aborted':
        return 'Generation was cancelled.';
    }
  }
}
