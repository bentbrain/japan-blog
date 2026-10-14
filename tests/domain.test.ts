import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  daySchema,
  tokyoDay,
  metadataSchema,
  captureInputValue,
  captureTimeFromInput,
} from '../src/lib/model';
import {
  validateMedia,
  embeddedMediaReferences,
} from '../src/plugins/trip-policy';
import { iso6709 } from '../src/lib/metadata';
import { storyTitle, tileCenters } from '../src/lib/story';

void test('capture times group into Japan days across UTC midnight', () => {
  assert.equal(tokyoDay(new Date('2026-10-14T14:59:59Z')), '2026-10-14');
  assert.equal(tokyoDay(new Date('2026-10-14T15:00:00Z')), '2026-10-15');
});
void test('Japan capture inputs preserve precision and unchanged ISO timestamps', () => {
  const original = '2026-10-15T11:15:42.123Z';
  const input = captureInputValue(original);
  assert.equal(input, '2026-10-15T20:15:42.123');
  assert.equal(captureTimeFromInput(input, original), original);
  assert.equal(
    captureTimeFromInput('2026-10-15T20:15', '2026-10-15T11:15:00Z'),
    '2026-10-15T11:15:00Z',
  );
  assert.equal(
    new Date(
      captureTimeFromInput('2026-10-16T00:01:07.456', original),
    ).toISOString(),
    '2026-10-15T15:01:07.456Z',
  );
  assert.equal(
    captureTimeFromInput('2026-10-15T20:15'),
    '2026-10-15T20:15:00+09:00',
  );
  assert.equal(captureInputValue(null), '');
  assert.throws(() => captureTimeFromInput(''));
});
void test('inline and gallery media cannot bypass location checks', () => {
  assert.deepEqual(
    embeddedMediaReferences([
      { _type: 'image', asset: { _ref: 'photo-1' } },
      {
        _type: 'gallery',
        images: [{ _type: 'image', asset: { _ref: 'photo-2' } }],
      },
      { _type: 'video' },
    ]),
    ['photo-1', 'photo-2', ''],
  );
});
void test('invalid calendar dates and out-of-range pins are rejected', () => {
  assert.equal(daySchema.safeParse('2026-02-30').success, false);
  assert.equal(daySchema.safeParse('2028-02-29').success, true);
  assert.equal(
    metadataSchema.safeParse({
      title: 'photo',
      captured_at: '2026-10-14',
      latitude: 91,
      longitude: 140,
      categories: [],
    }).success,
    false,
  );
});
const photo = {
  title: 'Tokyo',
  captured_at: '2026-10-14T10:00:00Z',
  latitude: 35.6895,
  longitude: 139.6917,
  categories: ['food', 'shopping'],
  kind: 'photo',
  asset: { id: 'asset-1' },
};
void test('publishing requires a capture time, pin and stored asset', () => {
  assert.equal(validateMedia(photo), undefined);
  assert.match(
    validateMedia({ ...photo, latitude: undefined }) || '',
    /coordinates/,
  );
  assert.match(
    validateMedia({ ...photo, captured_at: undefined }) || '',
    /capture/,
  );
  for (const captured_at of [null, false, 0, '', '0', '2026-10-14', undefined])
    assert.match(validateMedia({ ...photo, captured_at }) || '', /capture/);
  assert.match(validateMedia({ ...photo, asset: undefined }) || '', /Upload/);
});
void test('short videos are allowed and longer or unmeasured videos are rejected', () => {
  assert.equal(
    validateMedia({ ...photo, kind: 'video', duration: 10 }),
    undefined,
  );
  assert.match(
    validateMedia({ ...photo, kind: 'video', duration: 10.2 }) || '',
    /10 seconds/,
  );
  assert.match(validateMedia({ ...photo, kind: 'video' }) || '', /10 seconds/);
});
void test('QuickTime GPS handles signed coordinates and optional altitude', () => {
  assert.deepEqual(iso6709('+35.6895+139.6917+013.2/'), {
    latitude: 35.6895,
    longitude: 139.6917,
  });
  assert.deepEqual(iso6709('-27.4700+153.0200/'), {
    latitude: -27.47,
    longitude: 153.02,
  });
  assert.equal(iso6709('+99.0000+181.0000/'), undefined);
  assert.equal(iso6709('missing'), undefined);
});
void test('all story tiles remain within Instagram safe margins at maximum selection', () => {
  for (const count of [1, 3, 10, 15]) {
    const centers = tileCenters(count);
    for (let i = 1; i < centers.length; i++) {
      const current = centers[i],
        previous = centers[i - 1];
      assert.ok(current && previous);
      assert.ok(current.x > previous.x);
      assert.ok(current.y > previous.y);
    }
    for (const tile of tileCenters(count)) {
      // The unskewed cards are wider; the angled cards extend further vertically.
      assert.ok(tile.x - 636 / 2 > 64);
      assert.ok(tile.x + 636 / 2 < 1016);
      assert.ok(tile.y - (636 * 0.23 + 436) / 2 - 8 > 400);
      assert.ok(tile.y + (636 * 0.23 + 436) / 2 + 8 < 1320);
    }
  }
});
void test('story day numbers count calendar days from the trip start', () => {
  assert.equal(storyTitle('2026-10-13', '2026-10-13', 'tokyo'), 'day 1: tokyo');
  assert.equal(storyTitle('2026-10-15', '2026-10-13', 'tokyo'), 'day 3: tokyo');
  assert.equal(storyTitle('2027-01-01', '2026-12-31', ''), 'day 2: japan');
});
