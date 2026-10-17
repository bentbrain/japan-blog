import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { z } from 'zod';
import { geoMercator, geoPath } from 'd3-geo';
import japan from '../lib/japan.json';
import { CategoryIconProviderStatus } from './CategoryIconProviderStatus';
import { CategoryIconStatus } from './CategoryIconStatus';
import { CreateCategory } from './CreateCategory';
import { BulkMediaEditor } from './BulkMediaEditor';
import type { MediaChanges } from '../lib/media-edits';
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
  saving,
  setSaving,
}: {
  item: Media;
  reload: () => Promise<void>;
  categories: string[];
  onCategories: (collection: CategoryCollection) => void;
  saving: boolean;
  setSaving: (saving: boolean) => void;
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
  const [uploadErrors, setUploadErrors] = useState<
    { file: File; message: string; retryable: boolean }[]
  >([]);
  const uploadLock = useRef(false);
  const [saving, setSaving] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editStatus, setEditStatus] = useState('');
  const [editErrors, setEditErrors] = useState<
    { id: string; title: string; message: string }[]
  >([]);
  const editLock = useRef(false);
  const [publishStatus, setPublishStatus] = useState('');
  const [publishErrors, setPublishErrors] = useState<
    { id: string; title: string; message: string }[]
  >([]);
  const publishLock = useRef(false);
  const [ready, setReady] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const selected = items.find((item) => item.id === selectedId);
  const drafts = items.filter((item) => item.status === 'draft');
  const publishSelection = drafts.filter((item) =>
    selectedIds.includes(item.id),
  );
  const editable = items.filter((item) =>
    ['draft', 'published'].includes(item.status),
  );
  const editSelection = editable.filter((item) =>
    selectedIds.includes(item.id),
  );
  async function editSelected(changes: MediaChanges) {
    if (editLock.current || !editSelection.length) return;
    editLock.current = true;
    setEditing(true);
    setEditErrors([]);
    const errors: { id: string; title: string; message: string }[] = [];
    let saved = 0;
    try {
      for (const [index, item] of editSelection.entries()) {
        setEditStatus(
          `saving ${String(index + 1)} / ${String(editSelection.length)}`,
        );
        try {
          await api(
            '/api/trip/media/edit',
            { id: item.id, revision: item._rev, changes },
            'PATCH',
          );
          saved++;
        } catch (error) {
          errors.push({
            id: item.id,
            title: item.data.title,
            message: error instanceof Error ? error.message : 'Save failed',
          });
          setEditErrors([...errors]);
        }
      }
      const summary = `${String(saved)} saved${errors.length ? `; ${String(errors.length)} failed` : ''}`;
      if (errors.length) setSelectedIds(errors.map((error) => error.id));
      try {
        await reload();
        setEditStatus(summary);
        // Retain a successful selection so the same drafts can be published next.
        if (!errors.length) setEditOpen(false);
      } catch {
        setSelectedIds([]);
        setEditStatus(
          `${summary}; could not refresh media. Reload the page before retrying.`,
        );
      }
    } finally {
      editLock.current = false;
      setEditing(false);
    }
  }
  async function publishSelected() {
    if (publishLock.current || !publishSelection.length) return;
    publishLock.current = true;
    setPublishing(true);
    setPublishErrors([]);
    const errors: { id: string; title: string; message: string }[] = [];
    let published = 0;
    try {
      for (const [index, item] of publishSelection.entries()) {
        setPublishStatus(
          `publishing ${String(index + 1)} / ${String(publishSelection.length)}`,
        );
        try {
          const result = z
            .object({
              data: z.object({
                _rev: z.string(),
                item: z.object({
                  id: z.string(),
                  status: z.literal('published'),
                }),
              }),
            })
            .parse(
              await api(
                `/_emdash/api/content/media_items/${encodeURIComponent(item.id)}/publish`,
                {
                  _rev: item._rev,
                },
              ),
            );
          setItems((values) =>
            values.map((value) =>
              value.id === result.data.item.id
                ? {
                    ...value,
                    status: result.data.item.status,
                    _rev: result.data._rev,
                  }
                : value,
            ),
          );
          setSelectedIds((ids) => ids.filter((id) => id !== item.id));
          published++;
        } catch (error) {
          errors.push({
            id: item.id,
            title: item.data.title,
            message: error instanceof Error ? error.message : 'Publish failed',
          });
          setPublishErrors([...errors]);
        }
      }
      const summary = `${String(published)} published${errors.length ? `; ${String(errors.length)} failed` : ''}`;
      // Refresh once for conflicts and uncertain network responses, never once per photo.
      try {
        await reload();
        setPublishStatus(summary);
      } catch {
        setPublishStatus(
          `${summary}; could not refresh media. Reload the page before retrying.`,
        );
      }
    } finally {
      publishLock.current = false;
      setPublishing(false);
    }
  }
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
    if (uploadLock.current || files.length === 0) return;
    uploadLock.current = true;
    setSelecting(false);
    setSelectedIds([]);
    setUploading(true);
    const errors = uploadErrors.filter((error) => !files.includes(error.file));
    setUploadErrors(errors);
    let uploaded = 0;
    let lastId: string | undefined;
    try {
      for (const [index, file] of files.entries()) {
        const prefix = `${String(index + 1)} / ${String(files.length)}`;
        let prepared;
        try {
          setStatus(`${prefix} preparing ${file.name}`);
          prepared = await prepareMedia(file, (stage) => {
            setStatus(`${prefix} ${stage}: ${file.name}`);
          });
        } catch (error) {
          errors.push({
            file,
            message:
              error instanceof Error ? error.message : 'could not prepare file',
            retryable: true,
          });
          setUploadErrors([...errors]);
          continue;
        }
        try {
          const body = new FormData();
          body.set('original', file);
          body.set('display', prepared.display);
          body.set('poster', prepared.poster);
          setStatus(`${prefix} uploading ${file.name}`);
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
          uploaded++;
          lastId = result.data.item.id;
        } catch {
          // A lost response can follow a saved upload. Do not retry it blindly.
          errors.push({
            file,
            message:
              'could not confirm upload. check media before uploading this file again.',
            retryable: false,
          });
          setUploadErrors([...errors]);
        }
      }
      const failed = errors.filter((error) =>
        files.includes(error.file),
      ).length;
      const summary = failed
        ? `${String(uploaded)} uploaded; ${String(failed)} failed`
        : 'uploaded';
      try {
        await reload();
        if (lastId) setSelectedId(lastId);
        setStatus(summary);
      } catch {
        setStatus(
          `${summary}; could not refresh media. reload the page to check saved uploads.`,
        );
      }
    } finally {
      uploadLock.current = false;
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }
  return (
    <>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1>media</h1>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <Button
            disabled={
              !ready ||
              uploading ||
              saving ||
              publishing ||
              editing ||
              !items.length
            }
            aria-pressed={selecting}
            onClick={() => {
              setSelecting(!selecting);
              setSelectedId(undefined);
              setSelectedIds([]);
            }}
          >
            {selecting ? 'CANCEL' : 'SELECT'}
          </Button>
          <CreateCategory onCreated={onCategories} />
          <Button
            variant="default"
            disabled={!ready || uploading || saving || publishing || editing}
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
          disabled={!ready || uploading || saving || publishing || editing}
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
      {uploadErrors.length > 0 && (
        <div className="my-3 space-y-2" id="upload-errors">
          <ul className="space-y-1 text-sm">
            {uploadErrors.map((error, index) => (
              <li key={`${String(index)}-${error.file.name}`}>
                {error.file.name}: {error.message}
              </li>
            ))}
          </ul>
          {uploadErrors.some((error) => error.retryable) && (
            <Button
              variant="outline"
              disabled={uploading || saving || publishing || editing}
              onClick={() => {
                void upload(
                  uploadErrors
                    .filter((error) => error.retryable)
                    .map((error) => error.file),
                );
              }}
            >
              RETRY FAILED FILES
            </Button>
          )}
        </div>
      )}
      <CategoryIconProviderStatus />
      {selecting && (
        <div
          className="sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-3 border bg-background p-3"
          aria-label="publish media"
        >
          <span className="text-sm">{editSelection.length} selected</span>
          <Button
            size="sm"
            disabled={publishing || editing || !editable.length}
            onClick={() => {
              setSelectedIds(editable.map((item) => item.id));
            }}
          >
            SELECT ALL
          </Button>
          <Button
            size="sm"
            disabled={publishing || editing || !drafts.length}
            onClick={() => {
              setSelectedIds(drafts.map((item) => item.id));
            }}
          >
            SELECT ALL DRAFTS
          </Button>
          <Button
            size="sm"
            disabled={publishing || editing || !selectedIds.length}
            onClick={() => {
              setSelectedIds([]);
            }}
          >
            CLEAR
          </Button>
          <Button
            disabled={publishing || editing || !editSelection.length}
            onClick={() => {
              setEditStatus('');
              setEditErrors([]);
              setEditOpen(true);
            }}
          >
            EDIT ({editSelection.length})
          </Button>
          <Button
            variant="default"
            disabled={publishing || editing || !publishSelection.length}
            onClick={() => {
              void publishSelected();
            }}
          >
            {publishing
              ? 'PUBLISHING'
              : `PUBLISH (${String(publishSelection.length)})`}
          </Button>
        </div>
      )}
      {editOpen && (
        <BulkMediaEditor
          count={editSelection.length}
          categories={categoryNames([
            ...categories,
            ...items.flatMap((item) => item.data.categories || []),
          ]).map((category) => category.label)}
          places={[
            ...new Set(
              items.flatMap((item) =>
                item.data.place ? [item.data.place] : [],
              ),
            ),
          ]}
          busy={editing}
          status={[
            editStatus,
            ...editErrors.map((error) => `${error.title}: ${error.message}`),
          ]
            .filter(Boolean)
            .join('\n')}
          onApply={editSelected}
          onClose={() => {
            setEditOpen(false);
          }}
        />
      )}
      <p
        id="edit-status"
        role="status"
        className="my-3 whitespace-pre-wrap empty:hidden"
      >
        {editStatus}
      </p>
      {!editOpen && editErrors.length > 0 && (
        <ul className="mb-4 space-y-2 text-sm" aria-label="editing errors">
          {editErrors.map((error) => (
            <li key={error.id}>
              {error.title}: {error.message}
            </li>
          ))}
        </ul>
      )}
      <p
        id="publish-status"
        role="status"
        className="my-3 whitespace-pre-wrap empty:hidden"
      >
        {publishStatus}
      </p>
      {publishErrors.length > 0 && (
        <ul className="mb-4 space-y-2 text-sm" aria-label="publishing errors">
          {publishErrors.map((error) => (
            <li key={error.id}>
              {error.title}: {error.message}
            </li>
          ))}
        </ul>
      )}
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
              aria-pressed={
                selecting
                  ? selectedIds.includes(item.id)
                  : selectedId === item.id
              }
              aria-controls={selecting ? undefined : 'media-details'}
              disabled={
                selecting &&
                (publishing ||
                  editing ||
                  !['draft', 'published'].includes(item.status))
              }
              aria-label={`${item.data.title}, ${item.status}`}
              data-feedback-id={`owner-media-${item.id}`}
              onClick={() => {
                if (selecting)
                  setSelectedIds((ids) =>
                    ids.includes(item.id)
                      ? ids.filter((id) => id !== item.id)
                      : [...ids, item.id],
                  );
                else setSelectedId(item.id);
              }}
            >
              <img
                src={poster(item)}
                alt={item.data.title}
                className="block h-auto w-full"
              />
              {selecting && ['draft', 'published'].includes(item.status) && (
                <span
                  aria-hidden="true"
                  className="absolute top-2 left-2 flex size-6 items-center justify-center border bg-background text-foreground"
                >
                  {selectedIds.includes(item.id) ? '✓' : ''}
                </span>
              )}
              <Badge className="absolute right-2 bottom-2">{item.status}</Badge>
            </Button>
          ))}
        </div>
        <Card
          id="media-details"
          className="max-h-[min(40rem,calc(100dvh-10rem))] gap-0 overflow-y-auto border-0 border-t py-4 shadow-none min-[601px]:border-t-0 min-[601px]:border-l min-[601px]:py-0"
        >
          <CardContent className="px-0 min-[601px]:pl-6">
            {selected && !selecting && (
              <Metadata
                key={selected.id}
                item={selected}
                reload={reload}
                categories={categories}
                onCategories={onCategories}
                saving={saving}
                setSaving={setSaving}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
