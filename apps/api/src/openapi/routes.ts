import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, Reflector } from '@nestjs/core';

import { IS_PUBLIC } from '../auth/auth.decorators';
import {
  API_DOC,
  type ApiDocOptions,
  ROUTE_SCHEMAS,
  type RouteSchemas,
} from '../common/zod-validation';
import { RATE_LIMIT_CLASS } from '../throttle/rate-limit';

import type { INestApplication } from '@nestjs/common';

export interface RouteInfo {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Express-style path including the global prefix, e.g. `/api/documents/:id`. */
  path: string;
  isPublic: boolean;
  rateLimitClass?: string;
  doc?: ApiDocOptions;
  schemas: RouteSchemas;
  controller: string;
  handler: string;
}

const join = (...parts: string[]) =>
  '/' +
  parts
    .flatMap((p) => p.split('/'))
    .filter(Boolean)
    .join('/');

/**
 * Every HTTP route registered by Nest controllers, read from decorator metadata. Used by the
 * OpenAPI generator and by the integration test that proves every non-public route needs auth.
 */
export function listRoutes(app: INestApplication, prefix = 'api'): RouteInfo[] {
  const discovery = app.get(DiscoveryService);
  const reflector = app.get(Reflector);
  const routes: RouteInfo[] = [];

  for (const wrapper of discovery.getControllers()) {
    const { metatype } = wrapper;
    if (!metatype || typeof metatype !== 'function') continue;
    const controllerPath =
      (Reflect.getMetadata(PATH_METADATA, metatype) as string | string[] | undefined) ?? '';
    const proto = metatype.prototype as Record<string, unknown>;

    for (const name of Object.getOwnPropertyNames(proto)) {
      const handler = proto[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const methodValue = Reflect.getMetadata(METHOD_METADATA, handler) as
        RequestMethod | undefined;
      const methodPath = Reflect.getMetadata(PATH_METADATA, handler) as
        string | string[] | undefined;
      if (methodValue === undefined || methodPath === undefined) continue;

      const method = RequestMethod[methodValue] as RouteInfo['method'];
      const targets = [handler, metatype];
      const cPaths = Array.isArray(controllerPath) ? controllerPath : [controllerPath];
      const mPaths = Array.isArray(methodPath) ? methodPath : [methodPath];
      for (const cp of cPaths) {
        for (const mp of mPaths) {
          routes.push({
            method,
            path: join(prefix, cp, mp),
            isPublic: reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, targets) === true,
            rateLimitClass: reflector.getAllAndOverride<string>(RATE_LIMIT_CLASS, targets),
            doc: reflector.get<ApiDocOptions | undefined>(API_DOC, handler as () => unknown),
            schemas: (Reflect.getMetadata(ROUTE_SCHEMAS, proto, name) ?? {}) as RouteSchemas,
            controller: metatype.name,
            handler: name,
          });
        }
      }
    }
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}
