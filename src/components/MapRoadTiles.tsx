import { useState } from 'react';
import type { MapTile } from '../lib/map-tiles';
import { Button } from './ui/button';

export function MapRoadTiles({
  tiles,
  width,
  height,
}: {
  tiles: MapTile[];
  width: number;
  height: number;
}) {
  const [failed, setFailed] = useState(new Set<string>());
  const [attempt, setAttempt] = useState(0);
  if (!tiles.length) return null;
  const unavailable = tiles.some((tile) => failed.has(tile.id));
  return (
    <foreignObject x={0} y={0} width={width} height={height}>
      <div className="pointer-events-none relative size-full" data-map-roads>
        {tiles.map((tile) => (
          <img
            key={`${tile.id}-${String(attempt)}`}
            data-map-tile={tile.id}
            src={tile.url}
            alt=""
            draggable={false}
            crossOrigin="anonymous"
            referrerPolicy="no-referrer"
            className="absolute max-w-none grayscale select-none dark:invert"
            style={{
              left: tile.x,
              top: tile.y,
              width: tile.size + 0.5,
              height: tile.size + 0.5,
              visibility: failed.has(tile.id) ? 'hidden' : 'visible',
            }}
            onLoad={() => {
              setFailed((current) => {
                if (!current.has(tile.id)) return current;
                const next = new Set(current);
                next.delete(tile.id);
                return next;
              });
            }}
            onError={() => {
              setFailed(
                (current) =>
                  new Set([
                    ...[...current].filter((id) =>
                      tiles.some((entry) => entry.id === id),
                    ),
                    tile.id,
                  ]),
              );
            }}
          />
        ))}
        <a
          href="https://maps.gsi.go.jp/development/ichiran.html#pale"
          target="_blank"
          rel="noreferrer"
          className="pointer-events-auto absolute bottom-8 left-3 bg-background px-1 text-[10px] text-foreground underline"
          aria-label="Map source: GSI Japan, colours adjusted"
        >
          地理院タイル · colours adjusted
        </a>
        {unavailable && (
          <div className="pointer-events-auto absolute top-3 left-3 flex items-center gap-2 border bg-background px-2 text-xs text-foreground">
            <span role="status">street map unavailable</span>
            <Button
              variant="link"
              className="h-11 p-0"
              onClick={() => {
                setFailed(new Set());
                setAttempt((current) => current + 1);
              }}
            >
              RETRY
            </Button>
          </div>
        )}
      </div>
    </foreignObject>
  );
}
