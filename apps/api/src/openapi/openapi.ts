import { createRequire } from 'node:module';
import path from 'node:path';

import { ERROR_CODES, ErrorEnvelope } from '@devimpact/shared';
import express from 'express';
import { z } from 'zod';

import { listRoutes, type RouteInfo } from './routes';

import type { INestApplication } from '@nestjs/common';

type JsonSchema = Record<string, unknown>;

const toSchema = (schema: z.ZodType, io: 'input' | 'output'): JsonSchema => {
  const json = z.toJSONSchema(schema, {
    io,
    unrepresentable: 'any',
    target: 'draft-2020-12',
  }) as JsonSchema;
  delete json.$schema;
  return json;
};

function parametersFor(route: RouteInfo) {
  const params: Record<string, unknown>[] = [];
  for (const [location, schema] of [
    ['path', route.schemas.params],
    ['query', route.schemas.query],
  ] as const) {
    if (!schema) continue;
    const json = toSchema(schema, 'input') as {
      properties?: Record<string, JsonSchema>;
      required?: string[];
    };
    for (const [name, prop] of Object.entries(json.properties ?? {})) {
      params.push({
        name,
        in: location,
        required: location === 'path' || (json.required ?? []).includes(name),
        schema: prop,
      });
    }
  }
  // Path params without a schema (should not happen, but keep the document valid).
  for (const match of route.path.matchAll(/:([A-Za-z0-9_]+)/g)) {
    const name = match[1];
    if (name && !params.some((p) => p.name === name && p.in === 'path')) {
      params.push({ name, in: 'path', required: true, schema: { type: 'string' } });
    }
  }
  return params;
}

/** OpenAPI 3.1 document generated from the controllers' Zod schemas (ADR-0006). */
export function buildOpenApiDocument(app: INestApplication): JsonSchema {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of listRoutes(app)) {
    const oaPath = route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    const status = String(route.doc?.status ?? (route.method === 'POST' ? 201 : 200));
    const dataSchema = route.doc?.response ? toSchema(route.doc.response, 'output') : {};
    const op: Record<string, unknown> = {
      operationId: `${route.controller}_${route.handler}`,
      summary: route.doc?.summary ?? `${route.method} ${route.path}`,
      tags: route.doc?.tags ?? [route.controller.replace(/Controller$/, '')],
      ...(route.doc?.deprecated ? { deprecated: true } : {}),
      ...(route.isPublic ? { security: [] } : {}),
      'x-rate-limit-class': route.rateLimitClass ?? (route.isPublic ? 'public' : 'default'),
      parameters: parametersFor(route),
      responses: {
        [status]: {
          description: 'Success',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['success', 'data'],
                properties: {
                  success: { const: true },
                  data: dataSchema,
                  meta: { type: 'object' },
                },
              },
            },
          },
        },
        default: {
          description: 'Error envelope (see error codes)',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
          },
        },
      },
    };
    if (route.schemas.body) {
      op.requestBody = {
        required: true,
        content: { 'application/json': { schema: toSchema(route.schemas.body, 'input') } },
      };
    }
    paths[oaPath] = { ...paths[oaPath], [route.method.toLowerCase()]: op };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'DevImpact AI API',
      version: '2.0.0-dev',
      description:
        'Authenticated with `Authorization: Bearer <JWT>` from the web app (`GET /api/auth/token`). ' +
        `Error codes: ${ERROR_CODES.join(', ')}.`,
    },
    servers: [{ url: '/' }],
    security: [{ bearer: [] }],
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: { ErrorEnvelope: toSchema(ErrorEnvelope, 'output') },
    },
    paths,
  };
}

const DOCS_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>DevImpact AI API</title>
<link rel="stylesheet" href="/api/docs/assets/swagger-ui.css"></head>
<body><div id="swagger-ui"></div>
<script src="/api/docs/assets/swagger-ui-bundle.js"></script>
<script src="/api/docs/init.js"></script>
</body></html>`;

const INIT_JS = `window.ui = SwaggerUIBundle({ url: '/api/docs/openapi.json', dom_id: '#swagger-ui' });`;

/**
 * Serves Swagger UI and the JSON document at `/api/docs` — **never in production** (D-006).
 * Registered as plain Express routes (outside Nest guards), so they need no token.
 */
export function mountOpenApiDocs(app: INestApplication): void {
  const server = app.getHttpAdapter().getInstance() as express.Express;
  let cached: JsonSchema | undefined;
  const document = () => (cached ??= buildOpenApiDocument(app));
  const require = createRequire(__filename);
  const assets = path.dirname(require.resolve('swagger-ui-dist/package.json'));

  server.get('/api/docs/openapi.json', (_req, res) => {
    res.json(document());
  });
  server.get('/api/docs/init.js', (_req, res) => {
    res.type('application/javascript').send(INIT_JS);
  });
  server.use('/api/docs/assets', express.static(assets, { index: false }));
  server.get(['/api/docs', '/api/docs/'], (_req, res) => {
    res.type('html').send(DOCS_HTML);
  });
}
