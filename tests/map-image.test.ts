import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { getPlatformProxy, type PlatformProxy } from 'wrangler';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { jpegDimensions, mapImage } from '../src/lib/map-image';

let directory: string;
let platform: PlatformProxy<{ DB: D1Database; MEDIA: R2Bucket }>;
const folder = '00000000-0000-4000-8000-000000000001';
const photo = '01AAAAAAAAAAAAAAAAAAAAAAAA';
const poster = '01BBBBBBBBBBBBBBBBBBBBBBBB';
const key = `trip/${folder}/photo.jpg`;
const sourceUrl = `/_emdash/api/media/file/${key}`;
const source = new Uint8Array([
  255, 216, 255, 224, 0, 4, 0, 0, 255, 192, 0, 8, 8, 6, 64, 4, 176, 0, 255, 218,
]);
const sizes = async (...args: Parameters<typeof mapImage>) =>
  (await mapImage(...args)).sizes || horizontal;
const horizontal = '(min-width: 672px) 614px, calc(100vw - 58px)';
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'synthetic-map-image-'));
  await writeFile(
    join(directory, 'worker.js'),
    'export default {fetch(){return new Response("synthetic")}}',
  );
  const configPath = join(directory, 'wrangler.json');
  await writeFile(
    configPath,
    JSON.stringify({
      name: 'synthetic-responsive-image',
      main: 'worker.js',
      compatibility_date: '2026-10-01',
      d1_databases: [
        {
          binding: 'DB',
          database_name: 'synthetic',
          database_id: '00000000-0000-0000-0000-000000000001',
        },
      ],
      r2_buckets: [{ binding: 'MEDIA', bucket_name: 'synthetic' }],
    }),
  );
  platform = await getPlatformProxy({
    configPath,
    persist: false,
    remoteBindings: false,
    envFiles: [],
  });
  const { DB, MEDIA } = platform.env;
  await DB.batch([
    DB.prepare(
      'CREATE TABLE media(id TEXT PRIMARY KEY, storage_key TEXT, mime_type TEXT, width INTEGER, height INTEGER)',
    ),
    DB.prepare(
      'CREATE TABLE ec_media_items(id TEXT PRIMARY KEY, kind TEXT, asset TEXT, poster TEXT, status TEXT, deleted_at TEXT, draft_revision_id TEXT)',
    ),
    DB.prepare(
      'INSERT INTO media(id,storage_key,mime_type) VALUES (?, ?, ?), (?, ?, ?)',
    ).bind(
      photo,
      key,
      'image/jpeg',
      poster,
      `trip/${folder}/poster.jpg`,
      'image/jpeg',
    ),
    DB.prepare(
      'INSERT INTO ec_media_items VALUES (?, ?, ?, ?, ?, NULL, ?)',
    ).bind(
      'synthetic',
      'photo',
      JSON.stringify({ id: photo }),
      JSON.stringify({ id: poster }),
      'published',
      'private-draft-revision',
    ),
  ]);
  for (const filename of ['photo.jpg', 'poster.jpg'])
    await MEDIA.put(`trip/${folder}/${filename}`, source, {
      httpMetadata: { contentType: 'image/jpeg' },
    });
});

beforeEach(async () => {
  await platform.env.DB.prepare(
    "UPDATE ec_media_items SET status='published', deleted_at=NULL",
  ).run();
  await platform.env.DB.prepare(
    'UPDATE media SET width=NULL,height=NULL,storage_key=? WHERE id=?',
  )
    .bind(key, photo)
    .run();
  await platform.env.MEDIA.put(key, source, {
    httpMetadata: { contentType: 'image/jpeg' },
  });
});
after(async () => {
  await platform.dispose();
  await rm(directory, { recursive: true, force: true });
});

void test('JPEG frame parsing handles baseline/progressive frames and rejects truncated or invalid headers', () => {
  assert.deepEqual(jpegDimensions(source), { width: 1200, height: 1600 });
  const progressive = source.slice();
  progressive[9] = 194;
  assert.deepEqual(jpegDimensions(progressive), { width: 1200, height: 1600 });
  for (let length = 0; length < 18; length++)
    assert.equal(jpegDimensions(source.slice(0, length)), undefined);
  const zero = source.slice();
  zero[15] = 0;
  zero[16] = 0;
  assert.equal(jpegDimensions(zero), undefined);
  assert.equal(
    jpegDimensions(new Uint8Array([255, 216, 255, 218, 0, 2])),
    undefined,
  );
});

void test('map sizes use a bounded live display header and existing metadata without reading originals', async () => {
  const reads: unknown[] = [];
  const MEDIA = {
    async get(
      key: string,
      options: { range: { offset: number; length: number } },
    ) {
      reads.push({ key, options });
      return platform.env.MEDIA.get(key, options);
    },
  };
  const env = { ...platform.env, MEDIA };
  assert.equal(
    await sizes('synthetic', sourceUrl, env),
    '(min-width: 672px) min(614px, 41.25dvh), min(calc(100vw - 58px), 41.25dvh)',
  );
  assert.deepEqual(reads, [
    { key, options: { range: { offset: 0, length: 65536 } } },
  ]);
  const mapPhoto = await mapImage('synthetic', sourceUrl, env);
  assert.match(mapPhoto.srcSet || '', /1600\/auto 1200w$/);
  assert.equal((mapPhoto.srcSet || '').split(',').length, 5);
  reads.length = 0;
  await platform.env.DB.prepare(
    'UPDATE media SET width=1600,height=1200 WHERE id=?',
  )
    .bind(photo)
    .run();
  assert.match(
    await sizes('synthetic', sourceUrl, env),
    /73.33333333333333dvh/,
  );
  assert.equal(reads.length, 0);
});

void test('drafts, deletion, wrong references and private/original sources never initiate header reads', async () => {
  let reads = 0;
  const env = {
    ...platform.env,
    MEDIA: {
      get() {
        reads++;
        return Promise.resolve(null);
      },
    },
  };
  for (const source of [
    '/demo/japan.jpg',
    'https://external.invalid/photo.jpg',
    '/_emdash/api/media/file/trip-private/originals/synthetic',
    '/_emdash/api/media/asset/01CCCCCCCCCCCCCCCCCCCCCCCC/photo.jpg',
  ])
    assert.equal(await sizes('synthetic', source, env), horizontal);
  await platform.env.DB.prepare(
    "UPDATE ec_media_items SET status='draft'",
  ).run();
  assert.equal(await sizes('synthetic', sourceUrl, env), horizontal);
  await platform.env.DB.prepare(
    "UPDATE ec_media_items SET status='published',deleted_at='synthetic'",
  ).run();
  assert.equal(await sizes('synthetic', sourceUrl, env), horizontal);
  assert.equal(reads, 0);
});

void test('revocation during a header read discards dimensions and errors retain photo availability', async () => {
  const env = {
    ...platform.env,
    MEDIA: {
      async get() {
        await platform.env.DB.prepare(
          "UPDATE ec_media_items SET status='draft'",
        ).run();
        return {
          httpMetadata: { contentType: 'image/jpeg' },
          arrayBuffer() {
            return Promise.resolve(source.slice().buffer);
          },
        };
      },
    },
  };
  assert.equal(await sizes('synthetic', sourceUrl, env), horizontal);
  await platform.env.DB.prepare(
    "UPDATE ec_media_items SET status='published'",
  ).run();
  assert.equal(
    await sizes('synthetic', sourceUrl, {
      ...platform.env,
      MEDIA: {
        get() {
          return Promise.reject(new Error('synthetic'));
        },
      },
    }),
    horizontal,
  );
});
