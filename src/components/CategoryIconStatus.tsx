import { useEffect, useState } from 'react';
import { z } from 'zod';
import { api } from '../lib/api-client';
import {
  categoryIconStatusSchema,
  categoryNames,
  type CategoryIconStatus as Status,
} from '../lib/category-icons';
import { Button } from './ui/button';

const responseSchema = z.object({ icons: z.array(categoryIconStatusSchema) });
function statusLabel(icon: Status) {
  if (icon.state === 'setup')
    return 'add OPENAI_API_KEY in deployment secrets and configure an image model';
  if (icon.state === 'configuration')
    return 'check the image service key, model and account access, then retry';
  if (icon.state === 'uncertain')
    return 'result unknown; retry may charge again';
  if (icon.state === 'default') return 'fallback';
  return icon.state;
}
export function CategoryIconStatus({ names }: { names: string[] }) {
  const [icons, setIcons] = useState<Status[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string>();
  const identity = categoryNames(names)
    .map((name) => name.normalized)
    .sort()
    .join('\n');
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const result = responseSchema.parse(
          await api('/api/trip/category-icons'),
        );
        if (active) {
          setIcons(result.icons);
          setError('');
        }
      } catch {
        if (active) setError('could not load icon status');
      }
    };
    void load();
    const refresh = () => {
      void load();
    };
    window.addEventListener('category-icons:changed', refresh);
    const timer = setInterval(() => {
      void load();
    }, 15_000);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('category-icons:changed', refresh);
    };
  }, [identity]);
  const selected = new Set(categoryNames(names).map((name) => name.normalized));
  async function retry(icon: Status) {
    setBusy(icon.normalized);
    try {
      await api('/api/trip/category-icons', {
        category: icon.label,
        acknowledgeCharge: icon.state === 'uncertain',
      });
      setIcons(
        responseSchema.parse(await api('/api/trip/category-icons')).icons,
      );
      setError('');
      window.dispatchEvent(new Event('category-icons:changed'));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'could not retry icon');
    } finally {
      setBusy(undefined);
    }
  }
  return (
    <div className="space-y-2 text-xs" aria-label="Category icons">
      {icons
        .filter((icon) => selected.has(icon.normalized))
        .map((icon) => (
          <div
            key={icon.normalized}
            className="flex flex-wrap items-center gap-2"
          >
            {icon.url && (
              <span
                aria-hidden="true"
                className="size-6 shrink-0 bg-current [mask-size:contain] [mask-repeat:no-repeat]"
                style={{ maskImage: `url("${icon.url}")` }}
              />
            )}
            <span>
              {icon.label} icon · {statusLabel(icon)}
            </span>
            {icon.canRetry && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={Boolean(busy)}
                onClick={() => {
                  void retry(icon);
                }}
              >
                {busy === icon.normalized
                  ? 'QUEUING'
                  : icon.state === 'ready'
                    ? 'REGENERATE'
                    : icon.state === 'uncertain'
                      ? 'RETRY (MAY CHARGE)'
                      : 'RETRY'}
              </Button>
            )}
          </div>
        ))}
      <p role="status" className="empty:hidden">
        {error}
      </p>
    </div>
  );
}
