import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tripMap } from '../src/lib/map';

void test('map keeps worldwide media markers inside its visible bounds', () => {
  for (const media of [
    [],
    [{ latitude: 35.6895, longitude: 139.6917 }],
    [{ latitude: -27.47, longitude: 153.02 }],
    [
      { latitude: -27.47, longitude: 153.02 },
      { latitude: 35.6895, longitude: 139.6917 },
      { latitude: 51.5, longitude: -0.12 },
      { latitude: -33.45, longitude: -70.67 },
      { latitude: 0, longitude: -180 },
      { latitude: 0, longitude: 180 },
      { latitude: -90, longitude: 0 },
      { latitude: 90, longitude: 0 },
    ],
  ]) {
    const { projectMedia, land } = tripMap(media);
    assert.ok(land);
    for (const item of media) {
      const point = projectMedia(item);
      assert.ok(point);
      const [x, y] = point;
      assert.ok(x >= 104.99 && x <= 650.01);
      assert.ok(y >= 19.99 && y <= 420.01);
    }
  }
});
