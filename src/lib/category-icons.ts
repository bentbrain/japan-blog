import { z } from 'zod';
import { categories } from './model';

export const iconPromptVersion = 'bent-pixel-v1';
export const iconModel = 'gpt-image-2.5-sunburst-2026-09-08';
export const supportedIconModels = [
  iconModel,
  'gpt-image-2.5-sunburst',
  'gpt-image-2.5-flare-2026-09-08',
  'gpt-image-2.5-flare',
  'gpt-image-1.5',
  'gpt-image-1-mini',
];
export function normalizeCategory(value: string) {
  const label = value.trim();
  const normalized = label
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
  if (
    !label ||
    label.length > 40 ||
    !normalized ||
    normalized.length > 40 ||
    /[\p{Cc}\p{Cf}]/u.test(label)
  )
    return undefined;
  return { label, normalized };
}
export function categoryNames(value: unknown) {
  const parsed = z.array(z.string()).safeParse(value);
  const unique = new Map<string, { label: string; normalized: string }>();
  for (const name of parsed.success ? parsed.data : []) {
    const category = normalizeCategory(name);
    if (category) unique.set(category.normalized, category);
  }
  return [...unique.values()];
}
export function isDefaultCategory(normalized: string) {
  return categories.includes(normalized);
}
export async function iconHash(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
export const categoryIconStatusSchema = z.object({
  label: z.string(),
  normalized: z.string(),
  state: z.enum([
    'default',
    'pending',
    'ready',
    'failed',
    'uncertain',
    'setup',
    'configuration',
  ]),
  canRetry: z.boolean(),
});
export type CategoryIconStatus = z.infer<typeof categoryIconStatusSchema>;
