import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { visibleCategoryNames } from '../../../lib/category-icon-access';
import { categoryNames } from '../../../lib/category-icons';
import {
  ownerIconStatuses,
  retryCategoryIcon,
} from '../../../lib/category-icon-jobs';

export const GET: APIRoute = async ({ locals }) =>
  Response.json({
    icons: await ownerIconStatuses(
      env,
      await visibleCategoryNames(locals.emdash),
    ),
  });
export const POST: APIRoute = async ({ request, locals }) => {
  const body = z
    .object({
      category: z.string().min(1).max(40),
      acknowledgeCharge: z.boolean().default(false),
    })
    .safeParse(await request.json().catch(() => null));
  if (!body.success)
    return Response.json({ error: 'Choose a saved category' }, { status: 400 });
  const selected = categoryNames([body.data.category])[0];
  if (
    !selected ||
    !categoryNames(await visibleCategoryNames(locals.emdash)).some(
      (name) => name.normalized === selected.normalized,
    )
  )
    return Response.json({ error: 'Choose a saved category' }, { status: 404 });
  const queued = await retryCategoryIcon(
    env,
    selected.label,
    body.data.acknowledgeCharge,
  );
  return queued
    ? Response.json({ queued: true })
    : Response.json(
        {
          error:
            'Icon retry unavailable. Check setup, pending work or generation limit.',
        },
        { status: 409 },
      );
};
