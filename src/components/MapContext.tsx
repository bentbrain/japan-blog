import { useEffect, useMemo, useRef, useState } from 'react';
import {
  contextTiles,
  contextTileUrl,
  decodeMapDetail,
  type MapDetail,
  type MapProjection,
} from '../lib/map-context';
import type { MapCamera, MapPoint, MapSize } from '../lib/map-view';

const layerStyles = new Map([
  ['AdmArea', 'fill-background stroke-none'],
  ['WA', 'fill-foreground/10 stroke-none dark:fill-foreground/15'],
  ['TpgphArea', 'fill-foreground/5 stroke-none'],
  ['Cstline', 'fill-none stroke-foreground/35 [stroke-width:0.8]'],
  ['RvrCL', 'fill-none stroke-foreground/20 [stroke-width:1]'],
  [
    'AdmBdry',
    'fill-none stroke-foreground/15 [stroke-width:0.7] [stroke-dasharray:3_4]',
  ],
  [
    'BldA',
    'fill-foreground/5 stroke-foreground/20 [stroke-width:0.6] dark:fill-foreground/10',
  ],
  ['RdCL', 'fill-none stroke-foreground/20 [stroke-width:1]'],
  [
    'RailCL',
    'fill-none stroke-foreground/45 [stroke-width:1] [stroke-dasharray:3_2]',
  ],
]);

export function MapContext({
  camera,
  size,
  projection,
  pins,
  onUnavailable,
  revision,
}: {
  camera: MapCamera;
  size: MapSize;
  projection: MapProjection;
  pins: MapPoint[];
  onUnavailable: (unavailable: boolean) => void;
  revision: number;
}) {
  const cache = useRef(new Map<string, MapDetail>());
  const [details, setDetails] = useState(new Map<string, MapDetail>());
  const tiles = contextTiles(camera, size, projection);
  const key = tiles.map((tile) => tile.key).join(',');
  // Stable input while panning within a tile avoids aborting an in-flight fetch.
  const wanted = useMemo(() => key.split(',').filter(Boolean), [key]);
  useEffect(() => {
    const controller = new AbortController();
    const update = () => {
      setDetails(
        new Map(
          wanted.flatMap((key) => {
            const detail = cache.current.get(key);
            return detail ? [[key, detail]] : [];
          }),
        ),
      );
    };
    update();
    let failures = 0;
    const timer = setTimeout(() => {
      void Promise.all(
        wanted.map(async (key) => {
          if (cache.current.has(key)) return;
          try {
            const response = await fetch(contextTileUrl({ key }), {
              signal: AbortSignal.any([
                controller.signal,
                AbortSignal.timeout(8000),
              ]),
              credentials: 'omit',
              referrerPolicy: 'no-referrer',
            });
            if (response.status === 404) {
              cache.current.set(key, { paths: [], labels: [] });
            } else {
              if (!response.ok) throw new Error('Map detail unavailable');
              const data = await response.arrayBuffer();
              if (data.byteLength > 2_000_000)
                throw new Error('Map detail too large');
              cache.current.set(key, decodeMapDetail(data));
            }
            if (!controller.signal.aborted) update();
          } catch {
            if (!controller.signal.aborted) failures++;
          }
        }),
      ).then(() => {
        if (controller.signal.aborted) return;
        onUnavailable(failures > 0);
        // A bounded per-map cache reuses nearby tiles through pan/zoom.
        for (const key of cache.current.keys()) {
          if (cache.current.size <= 64) break;
          if (!wanted.includes(key)) cache.current.delete(key);
        }
      });
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [wanted, onUnavailable, revision]);

  const labels: { x: number; y: number; text: string; priority: number }[] = [];
  const rendered = tiles.map((tile) => {
    const detail = details.get(tile.key);
    if (!detail || !detail.paths.length) return null;
    const tileSize = (projection.worldSize / 2 ** tile.z) * camera.zoom;
    const x =
      (projection.x +
        (tile.x * projection.worldSize) / 2 ** tile.z -
        camera.x) *
        camera.zoom +
      size.width / 2;
    const y =
      (projection.y +
        (tile.y * projection.worldSize) / 2 ** tile.z -
        camera.y) *
        camera.zoom +
      size.height / 2;
    for (const label of detail.labels)
      labels.push({
        ...label,
        x: x + (label.x / 4096) * tileSize,
        y: y + (label.y / 4096) * tileSize,
      });
    return (
      <svg
        key={tile.key}
        data-map-vector-tile={tile.key}
        x={x}
        y={y}
        width={tileSize}
        height={tileSize}
        viewBox="0 0 4096 4096"
        overflow="hidden"
      >
        <rect
          width="4096"
          height="4096"
          className={tile.z <= 7 ? 'fill-muted' : 'fill-background'}
        />
        {detail.paths
          .filter(
            (path) =>
              !(tile.z < 9 && path.layer === 'RdCL') &&
              !(tile.z < 7 && path.layer === 'RailCL'),
          )
          .map((path) => (
            <path
              key={path.layer}
              data-map-layer={path.layer}
              d={path.d}
              className={layerStyles.get(path.layer)}
              vectorEffect="non-scaling-stroke"
              fillRule="evenodd"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
      </svg>
    );
  });
  const occupied = pins.map((pin) => ({
    x: (pin.x - camera.x) * camera.zoom + size.width / 2 - 24,
    y: (pin.y - camera.y) * camera.zoom + size.height / 2 - 24,
    width: 210,
    height: 48,
  }));
  const visible = labels
    .toSorted((a, b) => a.priority - b.priority)
    .filter((label) => {
      const width = label.text.length * 10 + 12;
      const box = {
        x: label.x - width / 2,
        y: label.y - 10,
        width,
        height: 24,
      };
      if (
        box.x < 8 ||
        box.y < 12 ||
        box.x + width > size.width - 60 ||
        box.y + 24 > size.height - 44 ||
        occupied.some(
          (other) =>
            box.x < other.x + other.width &&
            box.x + width > other.x &&
            box.y < other.y + other.height &&
            box.y + box.height > other.y,
        )
      )
        return false;
      occupied.push(box);
      return true;
    });
  return (
    <g data-map-detail className="pointer-events-none" aria-hidden="true">
      {rendered}
      {visible.map((label) => (
        <text
          key={`${label.text}-${String(label.x)}-${String(label.y)}`}
          x={label.x}
          y={label.y + 4}
          textAnchor="middle"
          className="fill-foreground stroke-background font-mono text-[11px] [paint-order:stroke] [stroke-width:3]"
        >
          {label.text}
        </text>
      ))}
    </g>
  );
}
