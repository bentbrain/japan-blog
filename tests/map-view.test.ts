import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clusterMapPoints, fitMapPoints } from '../src/lib/map-view';

void test('nearby pins split with zoom and regroup on zoom out without losing media', () => {
  const points = [
    { x: 400, y: 220, id: 'first' },
    { x: 404, y: 220, id: 'nearby' },
    { x: 400, y: 220, id: 'same-gps' },
  ];
  assert.deepEqual(
    clusterMapPoints(points, 1).map((group) => group.items.length),
    [3],
  );
  const zoomed = clusterMapPoints(points, 16);
  assert.deepEqual(
    zoomed.map((group) => group.items.map((item) => item.id)),
    [['first', 'same-gps'], ['nearby']],
  );
  assert.deepEqual(
    clusterMapPoints(points, 1).map((group) => group.items.length),
    [3],
  );
  assert.deepEqual(
    points.map((point) => point.x),
    [400, 404, 400],
  );
});

void test('mobile camera frames photo locations closely while keeping every pin within reach', () => {
  const points = [
    { x: 410, y: 220 },
    { x: 470, y: 230 },
  ];
  const size = { width: 358, height: 390 };
  const camera = fitMapPoints(points, size);
  assert.equal(camera.zoom, 3);
  for (const point of points) {
    const x = (point.x - camera.x) * camera.zoom + size.width / 2;
    assert.ok(x >= 44 && x <= size.width - 44);
  }
  assert.equal(fitMapPoints(points.slice(0, 1), size).zoom, 3);
  assert.ok(Number.isFinite(fitMapPoints([], size).zoom));
});
