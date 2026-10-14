import { z } from 'zod';
import type { ProseMirrorNode } from 'emdash';
import { daySchema } from './model';
const nodeSchema: z.ZodType<ProseMirrorNode> = z.lazy(() =>
  z.object({
    type: z.string(),
    attrs: z.record(z.string(), z.unknown()).optional(),
    content: z.array(nodeSchema).optional(),
    marks: z
      .array(
        z.object({
          type: z.string(),
          attrs: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .optional(),
    text: z.string().optional(),
  }),
);
const documentSchema = z.object({
  type: z.literal('doc'),
  content: z.array(nodeSchema),
});
export const editorPostSchema = z.object({
  id: z.string(),
  revision: z.string(),
  status: z.string(),
  data: z.object({
    title: z.string(),
    day: daySchema,
    place: z.string(),
    gallery: z.array(z.string()),
    document: documentSchema,
  }),
});
export type EditorPost = z.infer<typeof editorPostSchema>;
export const postInputSchema = z.object({
  id: z.string().optional(),
  revision: z.string().optional(),
  title: z.string().trim().min(1).max(200),
  day: daySchema,
  place: z.string().max(200),
  gallery: z.array(z.string()).max(100),
  document: documentSchema,
  publish: z.boolean(),
});
