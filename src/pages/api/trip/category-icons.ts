import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { visibleCategoryNames } from '../../../lib/category-icon-access';
import {
  categoryIconStatusResponse,
  categoryIconRetryResponse,
} from '../../../lib/category-icon-api';

export const GET: APIRoute = async ({ locals }) =>
  categoryIconStatusResponse(env, await visibleCategoryNames(locals.emdash));
export const POST: APIRoute = ({ request, locals }) =>
  categoryIconRetryResponse(env, request, () =>
    visibleCategoryNames(locals.emdash),
  );
