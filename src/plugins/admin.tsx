import { useEffect, useState } from 'react';
import { Checkbox } from '@cloudflare/kumo';
import { z } from 'zod';
import { galleryIds } from '../lib/model';
import { api } from '../lib/api-client';
import './admin.css';

const itemSchema = z.object({
  id: z.string(),
  status: z.string(),
  data: z.object({
    title: z.string(),
    poster: z.object({ src: z.string().optional() }).nullish(),
    poster_url: z.string().nullish(),
    asset: z.object({ url: z.string().optional() }).nullish(),
    source_url: z.string().nullish(),
  }),
});
function GalleryField({
  value,
  onChange,
  label,
}: {
  value: unknown;
  onChange: (value: string[]) => void;
  label: string;
}) {
  const [items, setItems] = useState<z.infer<typeof itemSchema>[]>([]),
    [error, setError] = useState('');
  const selected = galleryIds(value);
  useEffect(() => {
    let cancelled = false;
    api('/api/trip/media')
      .then((data) => {
        if (!cancelled)
          setItems(
            z
              .object({ items: z.array(itemSchema) })
              .parse(data)
              .items.filter((item) => item.status === 'published'),
          );
      })
      .catch(() => {
        if (!cancelled) setError('Could not load trip media');
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <fieldset className="trip-gallery-field">
      <legend>{label}</legend>
      <a href="/owner/media" target="_blank" rel="noopener">
        UPLOAD / EDIT MEDIA ↗
      </a>
      {error && <p role="alert">{error}</p>}
      <div className="trip-gallery-options">
        {items.map((item) => (
          <div key={item.id}>
            <img
              src={
                item.data.poster?.src ||
                item.data.poster_url ||
                item.data.asset?.url ||
                item.data.source_url ||
                ''
              }
              alt=""
            />
            <Checkbox
              label={item.data.title}
              checked={selected.includes(item.id)}
              onCheckedChange={(checked) => {
                onChange(
                  checked
                    ? [...selected, item.id]
                    : selected.filter((id) => id !== item.id),
                );
              }}
            />
          </div>
        ))}
      </div>
    </fieldset>
  );
}
export const fields = { gallery: GalleryField };
