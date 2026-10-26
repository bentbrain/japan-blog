import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tripMap } from '../src/lib/map';
import { visibleMapTiles } from '../src/lib/map-tiles';

void test('road tiles align with independently calculated geographic positions, including outlying islands', () => {
  const locations = [
    { latitude: 35.681236, longitude: 139.767125 },
    { latitude: 26.2124, longitude: 127.6809 },
    { latitude: 24.283, longitude: 153.987 },
  ];
  for (const media of [[], locations]) {
    const map = tripMap(media);
    for (const location of locations) {
      const point = map.projectMedia(location);
      assert.ok(point);
      for (const zoom of [96, 3072, 4096]) {
        const viewport = { width: 1230, height: 440 };
        const tiles = visibleMapTiles(
          map.world,
          { x: point[0], y: point[1], zoom },
          viewport,
        );
        assert.ok(tiles.length > 0 && tiles.length <= 24);
        const level = Number(tiles[0]?.id.split('/')[0]);
        // Standard XYZ formula, independent of our D3 affine conversion.
        const longitude = ((location.longitude + 180) / 360) * 2 ** level;
        const latitude = (location.latitude * Math.PI) / 180;
        const northing =
          ((1 - Math.asinh(Math.tan(latitude)) / Math.PI) / 2) * 2 ** level;
        const tile = tiles.find(
          (entry) =>
            entry.id ===
            `${String(level)}/${String(Math.floor(longitude))}/${String(Math.floor(northing))}`,
        );
        assert.ok(tile);
        assert.ok(
          Math.abs(tile.x + (longitude % 1) * tile.size - viewport.width / 2) <
            1e-6,
        );
        assert.ok(
          Math.abs(tile.y + (northing % 1) * tile.size - viewport.height / 2) <
            1e-6,
        );
        assert.ok(level >= 9 && level <= 18);
        for (const entry of tiles) {
          assert.ok(entry.x < viewport.width && entry.x + entry.size > 0);
          assert.ok(entry.y < viewport.height && entry.y + entry.size > 0);
          assert.match(
            entry.url,
            /^https:\/\/cyberjapandata\.gsi\.go\.jp\/xyz\/pale\/\d+\/\d+\/\d+\.png$/,
          );
        }
      }
    }
  }
});

void test('overview makes no provider requests and panning beyond the world stays bounded', () => {
  const { world } = tripMap([]);
  const viewport = { width: 390, height: 390 };
  assert.deepEqual(
    visibleMapTiles(world, { x: 400, y: 220, zoom: 3 }, viewport),
    [],
  );
  assert.deepEqual(
    visibleMapTiles(world, { x: 1e9, y: -1e9, zoom: 4096 }, viewport),
    [],
  );
  const tiles = visibleMapTiles(
    world,
    { x: world.left, y: world.top, zoom: 4096 },
    viewport,
  );
  assert.ok(tiles.length > 0);
  for (const tile of tiles) assert.ok(!tile.id.includes('/-'));
});
