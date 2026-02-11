import { context, SpanStatusCode, trace } from '@opentelemetry/api';
import { NextFunction, Request, RequestHandler, Response } from 'express';

const tracer = trace.getTracer('smartops-backend-http');

type RouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown> | unknown;

const setBaseAttributes = (req: Request, routeName: string) => {
  const span = trace.getSpan(context.active());
  if (!span) {
    return;
  }

  span.setAttribute('http.route_name', routeName);
  span.setAttribute('http.method', req.method);
  span.setAttribute('http.target', req.originalUrl);

  const tenantId = req.header('x-tenant-id');
  if (tenantId) {
    span.setAttribute('smartops.tenant_id', tenantId);
  }

  const actorId = req.header('x-user-ref');
  if (actorId) {
    span.setAttribute('smartops.actor_id', actorId);
  }
};

export const withRouteSpan = (
  routeName: string,
  handler: RouteHandler,
): RequestHandler => {
  return (req, res, next) => {
    tracer.startActiveSpan(`http.${routeName}`, async span => {
      setBaseAttributes(req, routeName);

      try {
        await handler(req, res, next);

        span.setAttribute('http.status_code', res.statusCode);
        if (res.statusCode >= 500) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: `HTTP ${res.statusCode}`,
          });
        }
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: (error as Error).message,
        });
        next(error);
      } finally {
        span.end();
      }
    });
  };
};

type SpanOptions = {
  attributes?: Record<string, string | number | boolean | undefined>;
};

export const runWithSpan = async <T>(
  name: string,
  operation: () => Promise<T>,
  options?: SpanOptions,
): Promise<T> => {
  return tracer.startActiveSpan(name, async span => {
    try {
      Object.entries(options?.attributes ?? {}).forEach(([key, value]) => {
        if (value !== undefined) {
          span.setAttribute(key, value);
        }
      });

      const result = await operation();
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      throw error;
    } finally {
      span.end();
    }
  });
};
