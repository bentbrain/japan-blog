import type { MapCamera, MapSize } from './map-view';

// The existing D3 Mercator and XYZ tiles share the same world square.
export type MapWorld = { left: number; top: number; width: number };
export type MapTile = {
  id: string;
  url: string;
  x: number;
  y: number;
  size: number;
};

// GSI pale maps, electronic topographic tiles, zoom 9–18. Lower zooms
// retain our local overview. Live use requires the linked GSI attribution.
// https://maps.gsi.go.jp/development/ichiran.html#pale
// https://maps.gsi.go.jp/development/siyou.html
export function visibleMapTiles(
  world: MapWorld,
  camera: MapCamera,
  viewport: MapSize,
): MapTile[] {
  const worldSize = world.width * camera.zoom;
  const zoom = Math.min(18, Math.floor(Math.log2(worldSize / 256)));
  if (zoom < 9 || !Number.isFinite(zoom)) return [];
  const count = 2 ** zoom;
  const size = worldSize / count;
  const left = (world.left - camera.x) * camera.zoom + viewport.width / 2;
  const top = (world.top - camera.y) * camera.zoom + viewport.height / 2;
  const minX = Math.max(0, Math.floor(-left / size));
  const maxX = Math.min(
    count - 1,
    Math.ceil((viewport.width - left) / size) - 1,
  );
  const minY = Math.max(0, Math.floor(-top / size));
  const maxY = Math.min(
    count - 1,
    Math.ceil((viewport.height - top) / size) - 1,
  );
  const tiles: MapTile[] = [];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const id = `${String(zoom)}/${String(x)}/${String(y)}`;
      tiles.push({
        id,
        url: `https://cyberjapandata.gsi.go.jp/xyz/pale/${id}.png`,
        x: left + x * size,
        y: top + y * size,
        size,
      });
    }
  }
  return tiles;
}
