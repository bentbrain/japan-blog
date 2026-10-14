import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { z } from 'zod';

const base = 'http://127.0.0.1:4390';
const server = spawn(
  'pnpm',
  ['dev', '--host', '127.0.0.1', '--port', '4390', '--ignore-lock'],
  {
    env: { ...process.env, TEST_EPHEMERAL: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  },
);
let logs = '';
server.stdout.on('data', (value: Buffer) => {
  logs = (logs + value.toString()).slice(-8000);
});
server.stderr.on('data', (value: Buffer) => {
  logs = (logs + value.toString()).slice(-8000);
});
let cookie = '';
const item = z.object({
  success: z.literal(true),
  data: z.object({
    item: z.object({ id: z.string(), data: z.record(z.string(), z.unknown()) }),
    _rev: z.string().optional(),
  }),
});
async function request(
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
  signed = true,
) {
  return fetch(base + path, {
    method,
    redirect: 'manual',
    headers: {
      Origin: base,
      'X-EmDash-Request': '1',
      ...(signed ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function publish(collection: string, id: string) {
  const current = item.parse(
    await (await request(`/_emdash/api/content/${collection}/${id}`)).json(),
  );
  return request(`/_emdash/api/content/${collection}/${id}/publish`, {
    _rev: current.data._rev,
  });
}
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(base + '/_emdash/api/health');
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(ready, logs);
  const setup = await request(
    '/_emdash/api/setup/dev-bypass',
    {},
    'POST',
    false,
  );
  assert.equal(setup.status, 200, await setup.text());
  const login = await request(
    '/_emdash/api/auth/dev-bypass',
    undefined,
    'GET',
    false,
  );
  const loginBody = await login.text();
  assert.equal(login.status, 200, loginBody);
  cookie = login.headers.get('set-cookie')?.split(';')[0] || '';
  assert.ok(cookie, 'Development session missing');
  for (const { collection, field } of [
    { collection: 'posts', field: 'day' },
    { collection: 'beers', field: 'day' },
    { collection: 'media_items', field: 'captured_at' },
  ]) {
    const updated = await request(
      `/_emdash/api/schema/collections/${collection}/fields/${field}`,
      { indexed: true },
      'PUT',
    );
    assert.equal(updated.status, 200, await updated.text());
  }
  assert.equal(
    (await request('/api/trip/media', undefined, 'GET', false)).status,
    401,
  );
  assert.equal((await request('/owner', undefined, 'GET', false)).status, 302);
  assert.equal(
    (
      await fetch(base + '/api/trip/beers', {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ day: '2099-10-14', count: 5 }),
      })
    ).status,
    403,
  );
  assert.equal(
    (await request('/_emdash/api/users', undefined, 'GET')).status,
    403,
  );
  const photo = await readFile('public/demo/tokyo.jpg'),
    video = await readFile('public/demo/sample.mp4');
  const form = new FormData();
  form.set('original', new File([video], 'sample.mp4', { type: 'video/mp4' }));
  form.set('display', new File([video], 'sample.mp4', { type: 'video/mp4' }));
  form.set('poster', new File([photo], 'poster.jpg', { type: 'image/jpeg' }));
  const uploaded = await fetch(base + '/api/trip/upload', {
    method: 'POST',
    headers: { Cookie: cookie, Origin: base, 'X-EmDash-Request': '1' },
    body: form,
  });
  const uploadBody: unknown = await uploaded.json();
  assert.equal(uploaded.status, 201, JSON.stringify(uploadBody));
  const id = item.parse(uploadBody).data.item.id;
  assert.equal(
    (await publish('media_items', id)).status,
    422,
    'Locationless upload published',
  );
  let current = item.parse(
    await (await request(`/_emdash/api/content/media_items/${id}`)).json(),
  );
  const originalKey = z.string().parse(current.data.item.data.original_key);
  assert.equal(
    (
      await request(
        `/_emdash/api/media/file/${originalKey}`,
        undefined,
        'GET',
        false,
      )
    ).status,
    404,
  );
  const metadata = {
    title: 'Integration video',
    captured_at: '2099-10-15T00:15:00+09:00',
    latitude: 35.6895,
    longitude: 139.6917,
    place: 'tokyo',
    categories: ['food', 'shopping'],
  };
  for (const encoded of ['trip%2Dprivate', '%2574rip-private']) {
    const path = originalKey.replace('trip-private', encoded);
    assert.equal(
      (
        await request(
          `/_emdash/api/media/file/${path}`,
          undefined,
          'GET',
          false,
        )
      ).status,
      404,
    );
  }
  const bad = await request(
    '/api/trip/media',
    {
      id,
      revision: current.data._rev,
      publish: true,
      metadata: { ...metadata, latitude: 95 },
    },
    'PATCH',
  );
  assert.equal(bad.status, 400);
  const saved = await request(
    '/api/trip/media',
    { id, revision: current.data._rev, publish: true, metadata },
    'PATCH',
  );
  assert.equal(saved.status, 200, await saved.text());
  current = item.parse(
    await (await request(`/_emdash/api/content/media_items/${id}`)).json(),
  );
  for (let index = 0; index < 101; index++) {
    const draft = await request('/_emdash/api/content/media_items', {
      slug: `pagination-${index}-${crypto.randomUUID()}`,
      data: { title: 'Pagination fixture', kind: 'photo' },
    });
    assert.equal(draft.status, 201, await draft.text());
  }
  const libraryResponse = await request('/api/trip/media');
  const libraryBody: unknown = await libraryResponse.json();
  assert.equal(libraryResponse.status, 200, JSON.stringify(libraryBody));
  const library = z
    .object({
      items: z.array(
        z.object({
          id: z.string(),
          data: z.object({ asset: z.object({ url: z.string() }).nullish() }),
        }),
      ),
    })
    .parse(libraryBody);
  const asset = library.items.find((entry) => entry.id === id)?.data.asset;
  assert.ok(asset);
  const ranged = await fetch(base + asset.url, {
    headers: { Range: 'bytes=0-99' },
  });
  assert.equal(ranged.status, 206);
  assert.equal((await ranged.arrayBuffer()).byteLength, 100);
  const beerSaved = await request('/api/trip/beers', {
    day: '2099-10-15',
    count: 3,
  });
  assert.equal(beerSaved.status, 200, await beerSaved.text());
  assert.equal(
    (await request('/api/trip/beers', { day: '2099-10-15', count: 4 })).status,
    200,
  );
  const manifest = await request('/api/trip/story', {
    day: '2099-10-15',
    ids: [id],
    counter: 'both',
  });
  assert.equal(manifest.status, 200);
  const story = z
    .object({
      beers: z.object({ today: z.number() }),
      media: z.array(z.object({ id: z.string() })),
    })
    .parse(await manifest.json());
  assert.equal(story.beers.today, 4);
  assert.equal(story.media[0]?.id, id);
  assert.equal(
    (
      await request('/api/trip/story', {
        day: '2099-10-14',
        ids: [id],
        counter: 'both',
      })
    ).status,
    400,
  );
  const post = await request('/_emdash/api/content/posts', {
    slug: `integration-${crypto.randomUUID()}`,
    data: {
      title: 'integration post',
      day: '2099-10-15',
      gallery: [id],
      content: [
        {
          _type: 'block',
          _key: 'p',
          style: 'normal',
          children: [
            {
              _type: 'span',
              _key: 's',
              text: 'Full post body verification',
              marks: [],
            },
          ],
          markDefs: [],
        },
      ],
    },
  });
  const postId = item.parse(await post.json()).data.item.id;
  assert.equal((await publish('posts', postId)).status, 200);
  const home = await (await request('/', undefined, 'GET', false)).text();
  assert.ok(home.includes('Full post body verification'));
  assert.ok(home.includes('Integration video'));
  assert.ok(
    (
      await (
        await request('/gallery?category=food', undefined, 'GET', false)
      ).text()
    ).includes('Integration video'),
  );
  await request(`/_emdash/api/content/posts/${postId}`, undefined, 'DELETE');
  await request(`/_emdash/api/content/media_items/${id}`, undefined, 'DELETE');
  console.log(
    'Full flow passed: owner auth, CSRF, original privacy, R2 upload/ranges, GPS publication, categories, beer revisions, day exports and rich-text publication.',
  );
} finally {
  if (server.pid) process.kill(-server.pid, 'SIGTERM');
}
