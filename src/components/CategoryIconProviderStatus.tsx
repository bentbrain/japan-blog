import { useEffect, useState } from 'react';
import { z } from 'zod';
import { api } from '../lib/api-client';
import { Button } from './ui/button';

const providerSchema = z.object({
  paused: z.boolean(),
  canResume: z.boolean(),
});
export function CategoryIconProviderStatus() {
  const [provider, setProvider] = useState<z.infer<typeof providerSchema>>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const next = providerSchema.parse(
          await api('/api/trip/category-icons/provider'),
        );
        if (active) {
          setProvider(next);
          setError('');
          if (next.paused) setNotice('');
        }
      } catch {
        if (active) setError('could not load icon service status');
      }
    };
    void load();
    const timer = setInterval(() => {
      void load();
    }, 15_000);
    const refresh = () => {
      void load();
    };
    window.addEventListener('category-icons:changed', refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('category-icons:changed', refresh);
    };
  }, []);
  async function resume() {
    setBusy(true);
    try {
      await api('/api/trip/category-icons/provider', { action: 'resume' });
      setProvider(
        providerSchema.parse(await api('/api/trip/category-icons/provider')),
      );
      setError('');
      setNotice('icon generation resumed');
      window.dispatchEvent(new Event('category-icons:changed'));
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'could not resume icon generation',
      );
    } finally {
      setBusy(false);
    }
  }
  if (!provider?.paused && !error && !notice) return null;
  return (
    <section
      aria-label="Icon generation service"
      className="mb-5 space-y-2 border p-3 text-xs"
    >
      {provider?.paused && (
        <>
          <p>icon generation paused. check service access, then resume.</p>
          <p>
            resuming allows queued icons to generate and may incur charges.
            unknown results still need a separate retry.
          </p>
          {!provider.canResume && (
            <p>configure the image service before resuming.</p>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || !provider.canResume}
            onClick={() => {
              void resume();
            }}
          >
            {busy ? 'RESUMING' : 'RESUME QUEUED ICONS'}
          </Button>
        </>
      )}
      <p role="status" className="empty:hidden">
        {error || notice}
      </p>
    </section>
  );
}
