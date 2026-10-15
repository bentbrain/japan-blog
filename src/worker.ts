import type { ExportedHandler } from '@cloudflare/workers-types';
import handler, {
  createScheduledHandler,
  PluginBridge,
} from '@emdash-cms/cloudflare/worker';

import { runCategoryIconJobs } from './lib/category-icon-jobs';

export { PluginBridge };
const cmsScheduled = createScheduledHandler();

export default {
  ...handler,
  async scheduled(controller, env, ctx) {
    await cmsScheduled(controller, env, ctx);
    ctx.waitUntil(runCategoryIconJobs(env));
  },
} satisfies ExportedHandler<Cloudflare.Env>;
