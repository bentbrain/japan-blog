import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureOrder, selectGalleryItem } from '../src/lib/gallery-order';

const media = [
  { id: 'late', data: { captured_at: new Date('2026-10-15T10:00:00Z') } },
  { id: 'early', data: { captured_at: new Date('2026-10-15T09:00:00+09:00') } },
  { id: 'middle', data: { captured_at: new Date('2026-10-15T08:00:00Z') } },
];

void test('gallery defaults follow capture instants rather than upload or selection order', () => {
  const original = [...media];
  assert.deepEqual(
    captureOrder(media).map((item) => item.id),
    ['early', 'middle', 'late'],
  );
  assert.deepEqual(media, original);
  let selected: string[] = [];
  for (const id of ['late', 'early', 'middle'])
    selected = selectGalleryItem(selected, id, media, false);
  assert.deepEqual(selected, ['early', 'middle', 'late']);
});

void test('manual and saved gallery order survives adding media without duplicates', () => {
  assert.deepEqual(
    selectGalleryItem(['late', 'early'], 'middle', media, true),
    ['late', 'early', 'middle'],
  );
  assert.deepEqual(selectGalleryItem(['late', 'early'], 'early', media, true), [
    'late',
    'early',
  ]);
});

void test('equal capture times have deterministic order', () => {
  const date = new Date('2026-10-15T00:00:00Z');
  assert.deepEqual(
    captureOrder([
      { id: 'b', data: { captured_at: date } },
      { id: 'a', data: { captured_at: date } },
    ]).map((item) => item.id),
    ['a', 'b'],
  );
});
