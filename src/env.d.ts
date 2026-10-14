type KVNamespace = import('@cloudflare/workers-types').KVNamespace;
type R2Bucket = import('@cloudflare/workers-types').R2Bucket;
type D1Database = import('@cloudflare/workers-types').D1Database;

declare module 'cloudflare:workers' {
  export const env: Cloudflare.Env;
}

type ExportedHandlerScheduledHandler<
  E = unknown,
  P = unknown,
> = import('@cloudflare/workers-types').ExportedHandlerScheduledHandler<E, P>;
