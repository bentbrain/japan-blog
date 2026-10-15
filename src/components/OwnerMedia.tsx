import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { z } from 'zod';
import { geoMercator, geoPath } from 'd3-geo';
import japan from '../lib/japan.json';
import { CategoryIconProviderStatus } from './CategoryIconProviderStatus';
import { CategoryIconStatus } from './CategoryIconStatus';
import { CreateCategory } from './CreateCategory';
import { categoryNames } from '../lib/category-icons';
import {
  categoryCollectionSchema,
  type CategoryCollection,
} from '../lib/category-collection-model';
import { api } from '../lib/api-client';
import { prepareMedia } from '../lib/prepare-media';
import {
  captureInputValue,
  captureTimeFromInput,
  metadataSchema,
} from '../lib/model';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Checkbox } from './ui/checkbox';
import { Badge } from './ui/badge';
import { Card, CardContent } from './ui/card';
import { Field, FieldGroup, FieldLabel } from './ui/field';

const schema = z.object({
  id: z.string(),
  status: z.string(),
  _rev: z.string(),
  data: z.object({
    title: z.string(),
    captured_at: z.string().nullish(),
    latitude: z.number().nullish(),
    longitude: z.number().nullish(),
    place: z.string().nullish(),
    categories: z.array(z.string()).nullish(),
    poster: z.object({ src: z.string().optional() }).nullish(),
    asset: z.object({ url: z.string().optional() }).nullish(),
    poster_url: z.string().nullish(),
    source_url: z.string().nullish(),
  }),
});
function formString(data: FormData, name: string) {
  const value = data.get(name);
  return typeof value === 'string' ? value : '';
}
type Media = z.infer<typeof schema>;
const poster = (item: Media) =>
  item.data.poster?.src ||
  item.data.poster_url ||
  item.data.asset?.url ||
  item.data.source_url ||
  '';
const geometry = z
  .object({
    type: z.literal('MultiPolygon'),
    coordinates: z.array(z.array(z.array(z.array(z.number())))),
  })
  .parse(japan.geometry);
const projection = geoMercator().fitExtent(
  [
    [10, 10],
    [260, 330],
  ],
  geometry,
);
const land = geoPath(projection)(geometry) || '';

function Metadata({
  item,
  reload,
  categories,
  onCategories,
}: {
  item: Media;
  reload: () => Promise<void>;
  categories: string[];
  onCategories: (collection: CategoryCollection) => void;
}) {
  const captured = captureInputValue(item.data.captured_at);
  const storedLatitude = metadataSchema.shape.latitude.safeParse(
    item.data.latitude,
  );
  const hasLatitude = storedLatitude.success;
  const storedLongitude = metadataSchema.shape.longitude.safeParse(
    item.data.longitude,
  );
  const hasLongitude = storedLongitude.success;
  const [latitude, setLatitude] = useState(
    item.data.latitude?.toString() || '',
  );
  const [longitude, setLongitude] = useState(
    item.data.longitude?.toString() || '',
  );
  const [status, setStatus] = useState('');
  const [publicMedia, setPublicMedia] = useState(item.status === 'published');
  const [selectedCategories, setSelectedCategories] = useState(
    item.data.categories || [],
  );
  const [saving, setSaving] = useState(false);
  const pin =
    latitude && longitude
      ? projection([Number(longitude), Number(latitude)])
      : null;
  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSaving(true);
    try {
      await api(
        '/api/trip/media',
        {
          id: item.id,
          revision: item._rev,
          publish: data.get('publish') === 'on',
          metadata: {
            title: data.get('title'),
            captured_at:
              captured && item.data.captured_at
                ? item.data.captured_at
                : captureTimeFromInput(formString(data, 'captured')),
            latitude: storedLatitude.success
              ? storedLatitude.data
              : Number(latitude),
            longitude: storedLongitude.success
              ? storedLongitude.data
              : Number(longitude),
            place: data.get('place'),
            categories: selectedCategories,
          },
        },
        'PATCH',
      );
      await reload();
      setStatus('saved');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }
  return (
    <form
      id="metadata"
      onSubmit={(event) => {
        void save(event);
      }}
      className="space-y-4"
      data-feedback-id="media-metadata"
    >
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="media-title">title</FieldLabel>
          <Input
            id="media-title"
            name="title"
            defaultValue={item.data.title}
            required
          />
        </Field>
        {captured && item.data.captured_at ? (
          <Field>
            <span className="text-sm">captured in japan</span>
            <time dateTime={item.data.captured_at} className="text-sm">
              {captured.replace('T', ' ')}
            </time>
          </Field>
        ) : (
          <Field>
            <FieldLabel htmlFor="media-captured">captured in japan</FieldLabel>
            <Input
              id="media-captured"
              name="captured"
              type="datetime-local"
              step="0.001"
              defaultValue={captureInputValue(item.data.captured_at)}
              required
            />
          </Field>
        )}
        {(!hasLatitude || !hasLongitude) && (
          <>
            <div className="grid grid-cols-2 gap-2">
              {!hasLatitude && (
                <Field>
                  <FieldLabel htmlFor="latitude">latitude</FieldLabel>
                  <Input
                    id="latitude"
                    name="latitude"
                    type="number"
                    step="any"
                    min="-90"
                    max="90"
                    value={latitude}
                    onChange={(event) => {
                      setLatitude(event.target.value);
                    }}
                    required
                  />
                </Field>
              )}
              {!hasLongitude && (
                <Field>
                  <FieldLabel htmlFor="longitude">longitude</FieldLabel>
                  <Input
                    id="longitude"
                    name="longitude"
                    type="number"
                    step="any"
                    min="-180"
                    max="180"
                    value={longitude}
                    onChange={(event) => {
                      setLongitude(event.target.value);
                    }}
                    required
                  />
                </Field>
              )}
            </div>
            <svg
              id="pin-picker"
              viewBox="0 0 270 340"
              className="h-[170px] w-full border"
              aria-label="Japan pin picker; coordinates can also be entered above"
              onClick={(event) => {
                const matrix = event.currentTarget.getScreenCTM();
                if (!matrix) return;
                const point = new DOMPoint(
                  event.clientX,
                  event.clientY,
                ).matrixTransform(matrix.inverse());
                const coords = projection.invert?.([point.x, point.y]);
                if (coords) {
                  if (!hasLatitude) setLatitude(String(coords[1]));
                  if (!hasLongitude) setLongitude(String(coords[0]));
                }
              }}
            >
              <path d={land} fill="none" stroke="currentColor" />
              {pin && (
                <circle cx={pin[0]} cy={pin[1]} r="5" fill="currentColor" />
              )}
            </svg>
          </>
        )}
        <Field>
          <FieldLabel htmlFor="media-place">place</FieldLabel>
          <Input
            id="media-place"
            name="place"
            defaultValue={item.data.place || ''}
          />
        </Field>
        <div className="flex flex-wrap gap-3">
          {categoryNames([...selectedCategories, ...categories]).map(
            ({ label: category, normalized }) => (
              <Field
                key={category}
                orientation="horizontal"
                className="w-auto gap-1.5"
              >
                <Checkbox
                  id={`category-${encodeURIComponent(normalized)}`}
                  name="category"
                  value={category}
                  checked={categoryNames(selectedCategories).some(
                    (name) => name.normalized === normalized,
                  )}
                  disabled={
                    selectedCategories.length >= 20 &&
                    !categoryNames(selectedCategories).some(
                      (name) => name.normalized === normalized,
                    )
                  }
                  onCheckedChange={(checked) => {
                    setSelectedCategories((values) =>
                      checked
                        ? [...values, category]
                        : values.filter(
                            (value) =>
                              categoryNames([value])[0]?.normalized !==
                              normalized,
                          ),
                    );
                  }}
                />
                <FieldLabel
                  htmlFor={`category-${encodeURIComponent(normalized)}`}
                >
                  {category}
                </FieldLabel>
              </Field>
            ),
          )}
        </div>
        <CreateCategory
          onCreated={(collection, name) => {
            onCategories(collection);
            setSelectedCategories((values) =>
              values.length < 20
                ? categoryNames([...values, name]).map(
                    (category) => category.label,
                  )
                : values,
            );
          }}
        />
        <CategoryIconStatus names={selectedCategories} />
        <Field orientation="horizontal">
          <Checkbox
            id="media-public"
            name="publish"
            checked={publicMedia}
            onCheckedChange={setPublicMedia}
          />
          <FieldLabel htmlFor="media-public">public</FieldLabel>
        </Field>
      </FieldGroup>
      <Button variant="default" type="submit" disabled={saving}>
        SAVE
      </Button>
      <p
        id="save-status"
        className="my-3 whitespace-pre-wrap empty:hidden"
        role="status"
      >
        {status}
      </p>
    </form>
  );
}

export function OwnerMedia() {
  const [items, setItems] = useState<Media[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  function onCategories(collection: CategoryCollection) {
    setCategories(collection.categories.map((category) => category.label));
  }
  const [selectedId, setSelectedId] = useState<string>();
  const [status, setStatus] = useState('');
  const [uploading, setUploading] = useState(false);
  const [ready, setReady] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const selected = items.find((item) => item.id === selectedId);
  async function reload() {
    setItems(
      z.object({ items: z.array(schema) }).parse(await api('/api/trip/media'))
        .items,
    );
  }
  useEffect(() => {
    let active = true;
    api('/api/trip/categories')
      .then((result) => {
        if (active) onCategories(categoryCollectionSchema.parse(result));
      })
      .catch(() => {
        if (active) setStatus('could not load categories');
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    setReady(true);
    let cancelled = false;
    api('/api/trip/media')
      .then((data) => {
        if (!cancelled)
          setItems(z.object({ items: z.array(schema) }).parse(data).items);
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setStatus(
            error instanceof Error ? error.message : 'Could not load media',
          );
      });
    return () => {
      cancelled = true;
    };
  }, []);
  async function upload(files: File[]) {
    setUploading(true);
    try {
      for (const [index, file] of files.entries()) {
        setStatus(
          `${String(index + 1)} / ${String(files.length)} preparing ${file.name}`,
        );
        const prepared = await prepareMedia(file),
          body = new FormData();
        body.set('original', file);
        body.set('display', prepared.display);
        body.set('poster', prepared.poster);
        setStatus(`${String(index + 1)} / ${String(files.length)} uploading`);
        const response = await fetch('/api/trip/upload', {
          method: 'POST',
          headers: { 'X-EmDash-Request': '1' },
          body,
        });
        if (!response.ok)
          throw new Error(JSON.stringify(await response.json()));
        const result = z
          .object({ data: z.object({ item: z.object({ id: z.string() }) }) })
          .parse(await response.json());
        await reload();
        setSelectedId(result.data.item.id);
      }
      setStatus('uploaded');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }
  return (
    <>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1>media</h1>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <CreateCategory onCreated={onCategories} />
          <Button
            variant="default"
            disabled={!ready || uploading}
            onClick={() => fileInput.current?.click()}
          >
            UPLOAD
          </Button>
        </div>
        <Input
          ref={fileInput}
          id="upload"
          className="hidden"
          type="file"
          multiple
          accept="image/*,video/mp4,video/quicktime"
          disabled={!ready || uploading}
          onChange={(event) => {
            if (event.target.files) void upload(Array.from(event.target.files));
          }}
        />
      </div>
      <p
        id="upload-status"
        className="my-3 whitespace-pre-wrap empty:hidden"
        role="status"
      >
        {status}
      </p>
      <CategoryIconProviderStatus />
      <div className="grid grid-cols-1 items-start gap-6 min-[601px]:grid-cols-[minmax(0,1fr)_280px]">
        <div
          className="gallery-grid grid grid-cols-2 content-start items-start gap-[7px] min-[901px]:grid-cols-3"
          id="media-list"
        >
          {items.map((item) => (
            <Button
              key={item.id}
              variant="ghost"
              className="relative block h-auto min-w-0 overflow-hidden border-0 p-0"
              aria-pressed={selectedId === item.id}
              aria-controls="media-details"
              aria-label={`${item.data.title}, ${item.status}`}
              data-feedback-id={`owner-media-${item.id}`}
              onClick={() => {
                setSelectedId(item.id);
              }}
            >
              <img
                src={poster(item)}
                alt={item.data.title}
                className="block h-auto w-full"
              />
              <Badge className="absolute right-2 bottom-2">{item.status}</Badge>
            </Button>
          ))}
        </div>
        <Card
          id="media-details"
          className="max-h-[min(40rem,calc(100dvh-10rem))] gap-0 overflow-y-auto border-0 border-t py-4 shadow-none min-[601px]:border-t-0 min-[601px]:border-l min-[601px]:py-0"
        >
          <CardContent className="px-0 min-[601px]:pl-6">
            {selected && (
              <Metadata
                key={selected.id}
                item={selected}
                reload={reload}
                categories={categories}
                onCategories={onCategories}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
