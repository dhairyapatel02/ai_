import { BadRequestException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { z } from 'zod';

import { AppException } from './app-exception';
import { buildErrorEnvelope, normalizeError } from './http-exception.filter';
import { ZodValidationPipe } from './zod-validation';

describe('normalizeError (exception filter mapping, API_CONTRACT_V2 §2)', () => {
  it('keeps AppException code, status, message and details', () => {
    expect(normalizeError(new AppException('INTEGRATION_ACCOUNT_IN_USE', 'In use'))).toEqual({
      status: 409,
      code: 'INTEGRATION_ACCOUNT_IN_USE',
      message: 'In use',
    });
    expect(
      normalizeError(
        new AppException('RATE_LIMITED', 'Slow', { class: 'ai', retryAfterSeconds: 9 }),
      ),
    ).toMatchObject({
      status: 429,
      details: { class: 'ai', retryAfterSeconds: 9 },
    });
  });

  it('maps Nest HTTP exceptions by status with generic messages (no echoed internals)', () => {
    expect(normalizeError(new NotFoundException('Cannot GET /api/secret/path'))).toEqual({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Route not found',
    });
    expect(normalizeError(new BadRequestException('raw parser text'))).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
    });
    expect(normalizeError(new PayloadTooLargeException())).toMatchObject({
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
    });
  });

  it('maps body-parser errors', () => {
    expect(
      normalizeError(Object.assign(new Error('too big'), { type: 'entity.too.large' })),
    ).toMatchObject({
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
    });
    expect(
      normalizeError(
        Object.assign(new SyntaxError('Unexpected token'), { type: 'entity.parse.failed' }),
      ),
    ).toEqual({
      status: 400,
      code: 'VALIDATION_FAILED',
      message: 'Malformed JSON body',
    });
  });

  it('hides unexpected errors behind 500 INTERNAL (SEC-12)', () => {
    const prismaLike = new Error(
      'Invalid `prisma.user.findMany()` invocation in /app/dist/x.js:12',
    );
    expect(normalizeError(prismaLike)).toEqual({
      status: 500,
      code: 'INTERNAL',
      message: 'Something went wrong on our side',
    });
    expect(normalizeError('a string')).toMatchObject({ status: 500, code: 'INTERNAL' });
  });

  it('builds the error envelope with the request id', () => {
    expect(
      buildErrorEnvelope({ status: 404, code: 'NOT_FOUND', message: 'Not found' }, 'req-1'),
    ).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Not found', requestId: 'req-1' },
    });
  });
});

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(
    z.strictObject({ limit: z.coerce.number().int().max(100) }),
    'query',
  );

  it('returns parsed (coerced) values', () => {
    expect(pipe.transform({ limit: '20' })).toEqual({ limit: 20 });
  });

  it('throws VALIDATION_FAILED with location-prefixed issue paths', () => {
    try {
      pipe.transform({ limit: '1000', extra: 'x' });
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      const details = (error as AppException).details as {
        issues: { path: string; code: string }[];
      };
      expect((error as AppException).status).toBe(400);
      expect(details.issues.map((i) => i.path).sort()).toEqual(['query', 'query.limit']);
    }
  });

  it('treats a missing JSON body as an empty object', () => {
    const bodyPipe = new ZodValidationPipe(z.strictObject({ name: z.string().optional() }), 'body');
    expect(bodyPipe.transform(undefined)).toEqual({});
  });
});
