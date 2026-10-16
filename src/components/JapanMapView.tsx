import { useEffect, useRef, useState } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from './ui/popover';
import { Button, buttonVariants } from './ui/button';
import {
  clusterMapPoints,
  fitMapPoints,
  MAX_MAP_ZOOM,
  MIN_MAP_ZOOM,
  type MapCamera,
  type MapPoint,
} from '../lib/map-view';

type MapItem = MapPoint & {
  id: string;
  slug: string | null;
  title: string;
  place: string;
  src: string;
};
const controlClass =
  'size-11 bg-background p-0 text-foreground hover:bg-foreground hover:text-background dark:bg-background dark:hover:bg-foreground';

export function JapanMapView({
  land,
  points,
}: {
  land: string;
  points: MapItem[];
}) {
  const container = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, MapPoint>());
  const moved = useRef(false);
  const initialized = useRef(false);
  const [size, setSize] = useState({ width: 760, height: 440 });
  const [camera, setCamera] = useState<MapCamera>(() =>
    fitMapPoints(points, size),
  );
  const [active, setActive] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const groups = clusterMapPoints(points, camera.zoom);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const nextSize = {
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      };
      setSize(nextSize);
      if (!initialized.current) {
        const selected = points.find(
          (point) =>
            point.id === new URLSearchParams(location.search).get('media'),
        );
        setCamera(fitMapPoints(selected ? [selected] : points, nextSize));
        setActive(selected?.id ?? null);
        initialized.current = true;
        setReady(true);
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [points]);

  useEffect(() => {
    function focusSelected() {
      const selected = points.find(
        (point) =>
          point.id === new URLSearchParams(location.search).get('media'),
      );
      setActive(selected?.id ?? null);
      if (selected) setCamera(fitMapPoints([selected], size));
    }
    window.addEventListener('popstate', focusSelected);
    window.addEventListener('hashchange', focusSelected);
    return () => {
      window.removeEventListener('popstate', focusSelected);
      window.removeEventListener('hashchange', focusSelected);
    };
  }, [points, size]);

  function zoomBy(factor: number) {
    setActive(null);
    setCamera((current) => ({
      ...current,
      zoom: Math.max(
        MIN_MAP_ZOOM,
        Math.min(MAX_MAP_ZOOM, current.zoom * factor),
      ),
    }));
  }

  return (
    <div
      ref={container}
      className="map-wrap relative h-[390px] scroll-mt-28 overflow-hidden bg-background text-foreground [background-image:radial-gradient(color-mix(in_srgb,var(--foreground)_15%,transparent)_0.75px,transparent_0.75px)] [background-size:8px_8px] min-[601px]:h-[440px]"
      id="japan-map"
      data-feedback-id="japan-map"
      data-zoom={camera.zoom}
    >
      <svg
        className="size-full touch-none cursor-grab active:cursor-grabbing"
        viewBox={`0 0 ${String(size.width)} ${String(size.height)}`}
        aria-label="Japan media map"
        role="group"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (['+', '=', '-'].includes(event.key)) {
            event.preventDefault();
            zoomBy(event.key === '-' ? 0.5 : 2);
          }
          const direction = {
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, -1],
            ArrowDown: [0, 1],
          }[event.key];
          if (direction) {
            event.preventDefault();
            setActive(null);
            setCamera((current) => ({
              ...current,
              x: current.x + ((direction[0] ?? 0) * 60) / current.zoom,
              y: current.y + ((direction[1] ?? 0) * 60) / current.zoom,
            }));
          }
        }}
        onPointerDown={(event) => {
          if (
            event.button !== 0 ||
            !(event.target instanceof Element) ||
            !event.currentTarget.contains(event.target) ||
            event.target.closest('button')
          )
            return;
          event.currentTarget.setPointerCapture(event.pointerId);
          pointers.current.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
          });
          moved.current = false;
        }}
        onPointerMove={(event) => {
          const previous = pointers.current.get(event.pointerId);
          if (!previous) return;
          const next = { x: event.clientX, y: event.clientY };
          const other = [...pointers.current.entries()].find(
            ([id]) => id !== event.pointerId,
          )?.[1];
          const bounds = event.currentTarget.getBoundingClientRect();
          pointers.current.set(event.pointerId, next);
          moved.current = true;
          setActive(null);
          setCamera((current) => {
            const oldMid = other
              ? { x: (previous.x + other.x) / 2, y: (previous.y + other.y) / 2 }
              : previous;
            const newMid = other
              ? { x: (next.x + other.x) / 2, y: (next.y + other.y) / 2 }
              : next;
            const factor = other
              ? Math.hypot(next.x - other.x, next.y - other.y) /
                Math.max(
                  1,
                  Math.hypot(previous.x - other.x, previous.y - other.y),
                )
              : 1;
            const zoom = Math.max(
              MIN_MAP_ZOOM,
              Math.min(MAX_MAP_ZOOM, current.zoom * factor),
            );
            return {
              zoom,
              x:
                current.x +
                (oldMid.x - bounds.left - size.width / 2) / current.zoom -
                (newMid.x - bounds.left - size.width / 2) / zoom,
              y:
                current.y +
                (oldMid.y - bounds.top - size.height / 2) / current.zoom -
                (newMid.y - bounds.top - size.height / 2) / zoom,
            };
          });
        }}
        onPointerUp={(event) => {
          pointers.current.delete(event.pointerId);
        }}
        onPointerCancel={(event) => {
          pointers.current.delete(event.pointerId);
        }}
        onDoubleClick={(event) => {
          if (
            !moved.current &&
            event.target instanceof Element &&
            event.currentTarget.contains(event.target) &&
            !event.target.closest('button')
          )
            zoomBy(2);
        }}
      >
        <path
          className="fill-background stroke-foreground [stroke-width:0.8] dark:fill-muted"
          vectorEffect="non-scaling-stroke"
          transform={`translate(${String(size.width / 2)} ${String(size.height / 2)}) scale(${String(camera.zoom)}) translate(${String(-camera.x)} ${String(-camera.y)})`}
          strokeLinejoin="round"
          d={land}
        />
        {groups.map((group) => {
          const x = (group.x - camera.x) * camera.zoom + size.width / 2;
          const y = (group.y - camera.y) * camera.zoom + size.height / 2;
          const index = Math.max(
            0,
            group.items.findIndex((item) => item.id === active),
          );
          const selected = group.items[index];
          if (
            !selected ||
            x < 22 ||
            y < 22 ||
            x > size.width - 22 ||
            y > size.height - 22
          )
            return null;
          return (
            <Popover
              key={group.items[0]?.id}
              open={group.items.some((item) => item.id === active)}
              onOpenChange={(open, details) => {
                if (!open && details.reason === 'trigger-press') {
                  details.cancel();
                  return;
                }
                setActive(open ? selected.id : null);
              }}
            >
              <foreignObject
                x={x - 22}
                y={y - 22}
                width="44"
                height="44"
                overflow="visible"
              >
                <PopoverTrigger
                  disabled={!ready}
                  className="map-marker flex size-11 items-center justify-center rounded-full border-[1.5px] border-background bg-foreground p-0 text-xs text-white outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  aria-label={`${group.items[0]?.place || 'location'}, ${String(group.items.length)} items`}
                >
                  {group.items.length}
                </PopoverTrigger>
              </foreignObject>
              <text
                className="pointer-events-none fill-foreground stroke-background font-mono text-[11px] [paint-order:stroke] [stroke-width:3]"
                x={x + 26}
                y={y + 4}
              >
                {group.items[0]?.place}
              </text>
              <PopoverContent
                className="map-detail data-open:animate-none data-closed:animate-none relative max-h-[calc(100dvh-7rem)] w-[min(640px,calc(100vw-32px))] gap-3 overflow-y-auto rounded-none border border-border bg-background p-3 text-foreground shadow-none ring-0"
                side="bottom"
                align="center"
                sideOffset={10}
                data-feedback-id="map-preview"
              >
                <div className="flex items-center justify-between gap-3">
                  <PopoverTitle className="font-normal">
                    {selected.place} / {index + 1} of {group.items.length}
                  </PopoverTitle>
                  <Button
                    className={controlClass}
                    aria-label="Close map preview"
                    onClick={() => {
                      setActive(null);
                    }}
                  >
                    ×
                  </Button>
                </div>
                <img
                  src={selected.src}
                  alt={selected.title}
                  className="block h-auto max-h-[55dvh] w-auto max-w-full self-center object-contain"
                />
                <div className="flex items-center justify-between gap-3">
                  <Button
                    className={controlClass}
                    disabled={group.items.length < 2}
                    aria-label="Previous photo at this location"
                    onClick={() => {
                      setActive(
                        group.items[
                          (index - 1 + group.items.length) % group.items.length
                        ]?.id ?? null,
                      );
                    }}
                  >
                    ←
                  </Button>
                  <a
                    className={buttonVariants({
                      variant: 'link',
                      className: 'h-auto p-0 text-foreground',
                    })}
                    href={`/media/${selected.slug || selected.id}`}
                  >
                    VIEW MEDIA →
                  </a>
                  <Button
                    className={controlClass}
                    disabled={group.items.length < 2}
                    aria-label="Next photo at this location"
                    onClick={() => {
                      setActive(
                        group.items[(index + 1) % group.items.length]?.id ??
                          null,
                      );
                    }}
                  >
                    →
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          );
        })}
      </svg>
      {!points.length && (
        <span className="absolute bottom-3 left-3">
          no photos near japan yet
        </span>
      )}
    </div>
  );
}
