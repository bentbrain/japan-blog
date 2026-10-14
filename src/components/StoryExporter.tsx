import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { api } from '../lib/api-client';
import { loadStory, renderStory } from '../lib/story-renderer';
import { storySchema, type Story } from '../lib/story';
import { Button, buttonVariants } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Field, FieldLabel } from './ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Progress } from './ui/progress';

type Media = { id: string; day: string; title: string; poster: string };
const counterSchema = storySchema.shape.counter;
export function StoryExporter({ media }: { media: Media[] }) {
  const days = [...new Set(media.map((item) => item.day))].sort().reverse();
  const [day, setDay] = useState(days[0] || '');
  const [selected, setSelected] = useState<string[]>(
    media
      .filter((item) => item.day === days[0])
      .slice(0, 15)
      .map((item) => item.id),
  );
  const [counter, setCounter] = useState<Story['counter']>('both');
  const [guides, setGuides] = useState(true);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [download, setDownload] = useState<{ url: string; filename: string }>();
  const preview = useRef<HTMLDivElement>(null);
  const downloadLink = useRef<HTMLAnchorElement>(null);
  const renderer = useRef<Awaited<ReturnType<typeof loadStory>>>(undefined);
  const story = useRef<Story>(undefined);
  const abort = useRef<AbortController>(undefined);
  const visible = media.filter((item) => item.day === day);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const isActive = () => !cancelled;
    story.current = undefined;
    setReady(false);
    if (!selected.length) {
      setStatus('select photos');
      return;
    }
    async function update() {
      const manifest = storySchema.parse(
        await api('/api/trip/story', { day, ids: selected, counter }),
      );
      const loaded = await loadStory(manifest, controller.signal);
      if (!isActive()) {
        loaded.dispose();
        return;
      }
      renderer.current = loaded;
      story.current = manifest;
      await loaded.draw(0);
      if (isActive()) {
        preview.current?.replaceChildren(loaded.canvas);
        setReady(true);
        setStatus(`${String(selected.length)} selected`);
      }
    }
    void update().catch((error: unknown) => {
      if (isActive())
        setStatus(error instanceof Error ? error.message : 'Preview failed');
    });
    return () => {
      cancelled = true;
      controller.abort();
      renderer.current?.dispose();
      renderer.current = undefined;
      preview.current?.replaceChildren();
    };
  }, [day, selected, counter]);
  useEffect(() => {
    if (!playing || rendering) return;
    let frameId = 0,
      cancelled = false;
    const isActive = () => !cancelled;
    const started = performance.now();
    async function frame() {
      if (cancelled || !renderer.current) return;
      await renderer.current.draw((performance.now() - started) / 1000);
      if (isActive())
        frameId = requestAnimationFrame(() => {
          void frame();
        });
    }
    void frame().catch((error: unknown) => {
      setPlaying(false);
      setStatus(error instanceof Error ? error.message : 'Preview failed');
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
    };
  }, [playing, rendering]);
  useEffect(() => {
    if (download) downloadLink.current?.click();
  }, [download]);
  useEffect(
    () => () => {
      abort.current?.abort();
    },
    [],
  );
  async function exportStory(format: 'png' | 'mp4') {
    const manifest = story.current;
    if (!manifest || rendering) return;
    setPlaying(false);
    setRendering(true);
    setProgress(0);
    setStatus('rendering');
    const controller = new AbortController();
    abort.current = controller;
    try {
      const blob = await renderStory(
        manifest,
        format,
        (value) => {
          setProgress(value * 100);
          setStatus(`rendering ${String(Math.round(value * 100))}%`);
        },
        controller.signal,
      );
      controller.signal.throwIfAborted();
      setStatus('saving');
      const body = new FormData(),
        filename = `japan-story-${manifest.day}.${format}`;
      body.set('file', new File([blob], filename, { type: blob.type }));
      const response = await fetch('/api/trip/exports', {
        method: 'POST',
        headers: { 'X-EmDash-Request': '1' },
        body,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Could not save export');
      const result = z.object({ url: z.string() }).parse(await response.json());
      controller.signal.throwIfAborted();
      setDownload({ url: result.url, filename });
      setStatus('ready');
    } catch (error) {
      setStatus(
        controller.signal.aborted
          ? 'cancelled'
          : error instanceof Error
            ? error.message
            : 'Export failed',
      );
    } finally {
      setRendering(false);
    }
  }
  return (
    <>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1>story export</h1>
        <span>1080 × 1920</span>
      </div>
      <div className="grid grid-cols-1 gap-10 min-[601px]:grid-cols-[minmax(0,1fr)_minmax(280px,420px)]">
        <div id="export-form" className="space-y-4">
          <Field>
            <FieldLabel htmlFor="story-day">day</FieldLabel>
            <Select
              value={day}
              disabled={rendering}
              items={days.map((value) => ({ value, label: value }))}
              onValueChange={(value) => {
                if (!value) return;
                setPlaying(false);
                setDay(value);
                setSelected(
                  media
                    .filter((item) => item.day === value)
                    .slice(0, 15)
                    .map((item) => item.id),
                );
              }}
            >
              <SelectTrigger id="story-day" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {days.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div
            className="gallery-grid grid grid-cols-2 gap-[7px] min-[901px]:grid-cols-3"
            id="export-selection"
          >
            {visible.map((item) => (
              <div
                key={item.id}
                className="select-media relative"
                data-day={item.day}
              >
                <Checkbox
                  id={`export-${item.id}`}
                  name="media"
                  value={item.id}
                  checked={selected.includes(item.id)}
                  disabled={
                    rendering ||
                    (!selected.includes(item.id) && selected.length >= 15)
                  }
                  className="absolute top-2.5 right-2.5 z-10 size-5 bg-background"
                  onCheckedChange={(checked) => {
                    setPlaying(false);
                    setSelected((current) =>
                      checked
                        ? [...current, item.id]
                        : current.filter((id) => id !== item.id),
                    );
                  }}
                />
                <FieldLabel htmlFor={`export-${item.id}`} className="m-0 block">
                  <img
                    src={item.poster}
                    alt={item.title}
                    className="aspect-[1.15] w-full object-cover"
                  />
                  <span className="sr-only">{item.title}</span>
                </FieldLabel>
              </div>
            ))}
          </div>
          <Field>
            <FieldLabel htmlFor="story-counter">beer counter</FieldLabel>
            <Select
              value={counter}
              disabled={rendering}
              items={[
                { value: 'both', label: 'today + trip total' },
                { value: 'today', label: 'today' },
                { value: 'total', label: 'trip total' },
                { value: 'hidden', label: 'hidden' },
              ]}
              onValueChange={(value) => {
                const next = counterSchema.safeParse(value);
                if (next.success) {
                  setPlaying(false);
                  setCounter(next.data);
                }
              }}
            >
              <SelectTrigger id="story-counter" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="both">today + trip total</SelectItem>
                <SelectItem value="today">today</SelectItem>
                <SelectItem value="total">trip total</SelectItem>
                <SelectItem value="hidden">hidden</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field orientation="horizontal">
            <Checkbox
              id="safe-areas"
              checked={guides}
              onCheckedChange={setGuides}
            />
            <FieldLabel htmlFor="safe-areas">safe area guides</FieldLabel>
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              id="play-preview"
              disabled={rendering || !ready || !selected.length}
              onClick={() => {
                setPlaying(!playing);
              }}
            >
              {playing ? 'PAUSE' : 'PLAY PREVIEW'}
            </Button>
            <Button
              variant="default"
              disabled={rendering || !ready || !selected.length}
              onClick={() => {
                void exportStory('mp4');
              }}
            >
              EXPORT MP4
            </Button>
            <Button
              disabled={rendering || !ready || !selected.length}
              onClick={() => {
                void exportStory('png');
              }}
            >
              EXPORT PNG
            </Button>
            {rendering && (
              <Button id="cancel-export" onClick={() => abort.current?.abort()}>
                CANCEL
              </Button>
            )}
          </div>
          {rendering && (
            <Progress value={progress} aria-label="Story export progress" />
          )}
          <p
            id="export-status"
            className="whitespace-pre-wrap empty:hidden"
            role="status"
          >
            {status}
          </p>
          {download && (
            <a
              ref={downloadLink}
              id="download"
              href={download.url}
              download={download.filename}
              className={buttonVariants()}
            >
              DOWNLOAD
            </a>
          )}
        </div>
        <div
          className="relative aspect-[9/16] w-full max-w-[360px] justify-self-center overflow-hidden bg-[#0647ff] text-white min-[601px]:max-w-none [&_canvas]:size-full"
          data-feedback-id="story-composition"
        >
          <div id="story-preview" ref={preview} />
          {guides && (
            <div className="story-guides pointer-events-none absolute inset-x-[6%] top-[14.6%] bottom-[19.8%] border border-dashed border-white/50" />
          )}
        </div>
      </div>
    </>
  );
}
