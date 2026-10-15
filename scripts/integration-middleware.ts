import { defineMiddleware } from 'astro:middleware';
import { drainDeniedRequest } from './integration-transport';

export const onRequest = defineMiddleware(async (context, next) =>
  drainDeniedRequest(context.request, await next()),
);
