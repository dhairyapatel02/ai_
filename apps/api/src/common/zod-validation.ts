import {
  type ArgumentMetadata,
  Body,
  Param,
  type PipeTransform,
  Query,
  SetMetadata,
} from '@nestjs/common';

import { AppException } from './app-exception';

import type { ValidationIssue } from '@devimpact/shared';
import type { z } from 'zod';

type Location = 'body' | 'query' | 'params';

/**
 * Validates one request part against a shared Zod schema (ADR-0006). Failures become
 * `400 VALIDATION_FAILED` with `details.issues[]` whose paths start with the location
 * (`body.role`, `query.limit`, `params.id`).
 */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(
    private readonly schema: T,
    private readonly location: Location,
  ) {}

  transform(value: unknown, _metadata?: ArgumentMetadata): z.output<T> {
    // Express leaves `req.body` undefined for requests without a JSON body.
    const input = this.location === 'body' && value === undefined ? {} : value;
    const result = this.schema.safeParse(input);
    if (result.success) return result.data;
    const issues: ValidationIssue[] = result.error.issues.map((issue) => ({
      path: [this.location, ...issue.path.map(String)].join('.'),
      message: issue.message,
      code: issue.code,
    }));
    throw new AppException('VALIDATION_FAILED', 'The request is invalid', { issues });
  }
}

/** Metadata read by the OpenAPI generator (`src/openapi/openapi.ts`). */
export const ROUTE_SCHEMAS = 'devimpact:route-schemas';
export type RouteSchemas = Partial<Record<Location, z.ZodType>>;

function registerSchema(
  target: object,
  propertyKey: string | symbol | undefined,
  location: Location,
  schema: z.ZodType,
) {
  if (propertyKey === undefined) return;
  const existing = (Reflect.getMetadata(ROUTE_SCHEMAS, target, propertyKey) ?? {}) as RouteSchemas;
  Reflect.defineMetadata(ROUTE_SCHEMAS, { ...existing, [location]: schema }, target, propertyKey);
}

function zodParam(location: Location, base: (pipe: PipeTransform) => ParameterDecorator) {
  return (schema: z.ZodType): ParameterDecorator =>
    (target, propertyKey, index) => {
      registerSchema(target, propertyKey, location, schema);
      base(new ZodValidationPipe(schema, location))(target, propertyKey, index);
    };
}

/** `@ZodBody(Schema) body: z.infer<typeof Schema>` — validated JSON body. */
export const ZodBody = zodParam('body', (pipe) => Body(pipe));
/** `@ZodQuery(Schema) query` — validated (coerced) query string. */
export const ZodQuery = zodParam('query', (pipe) => Query(pipe));
/** `@ZodParams(Schema) params` — validated path parameters. */
export const ZodParams = zodParam('params', (pipe) => Param(pipe));

export interface ApiDocOptions {
  summary: string;
  tags?: string[];
  /** Zod schema of `data` in the success envelope. */
  response?: z.ZodType;
  /** Success status (default 200, 201 for POST unless overridden with @HttpCode). */
  status?: number;
  deprecated?: boolean;
  rateLimit?: string;
}
export const API_DOC = 'devimpact:api-doc';
/** Documents an endpoint for `/api/docs` (OpenAPI 3.1 generated from Zod). */
export const ApiDoc = (options: ApiDocOptions) => SetMetadata(API_DOC, options);
