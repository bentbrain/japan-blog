import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { portableTextToProsemirror, prosemirrorToPortableText } from 'emdash';
import { z } from 'zod';
import { editorExtensions } from '../src/lib/editor-extensions';
import { editorPostSchema } from '../src/lib/editor-model';
import { preservesContent } from '../src/lib/editor-conversion';

void test('native image metadata and gallery survive the actual editor schema', () => {
  const image = {
    _type: 'image',
    _key: 'photo',
    asset: { _ref: 'asset-1', url: '/photo.jpg' },
    caption: 'Dinner',
    alt: 'Ramen',
    width: 1200,
    height: 800,
    displayWidth: 640,
    alignment: 'center',
    link: { href: 'https://shop.bent.build', blank: true },
  };
  const gallery = {
    _type: 'gallery',
    _key: 'gallery',
    columns: 2,
    images: [image],
  };
  const document = portableTextToProsemirror([image, gallery]);
  const schema = getSchema(editorExtensions);
  const reconstructed = schema.nodeFromJSON(document);
  reconstructed.check();
  const restored = prosemirrorToPortableText(
    editorPostSchema.shape.data.shape.document.parse(reconstructed.toJSON()),
  );
  const imageFields = z.object({
    caption: z.string(),
    alt: z.string(),
    width: z.number(),
    height: z.number(),
    displayWidth: z.number(),
    alignment: z.string(),
    link: z.object({ href: z.string(), blank: z.boolean() }),
  });
  assert.deepEqual(imageFields.parse(restored[0]), imageFields.parse(image));
  const galleryFields = z.object({
    columns: z.number(),
    images: z.array(
      z.object({ caption: z.string(), asset: z.object({ _ref: z.string() }) }),
    ),
  });
  assert.deepEqual(
    galleryFields.parse(restored[1]),
    galleryFields.parse(gallery),
  );
});

void test('native video shapes unsupported by the toolbar retain their complete block', () => {
  const nativeVideo = {
    _type: 'video',
    _key: 'video-extra',
    asset: { _ref: 'asset-1', url: '/video.mp4' },
    poster: '/poster.jpg',
    caption: 'A short clip',
  };
  const converted = portableTextToProsemirror([nativeVideo], {
    preserveIdentity: true,
  });
  const node = getSchema(editorExtensions).nodeFromJSON(converted);
  node.check();
  const document = editorPostSchema.shape.data.shape.document.parse(
    node.toJSON(),
  );
  assert.deepEqual(prosemirrorToPortableText(document), [nativeVideo]);
});

void test('editing detects ignored properties inside otherwise supported gallery blocks', () => {
  const gallery = {
    _type: 'gallery',
    _key: 'custom-gallery',
    columns: 2,
    layout: 'custom-layout',
    images: [],
  };
  const node = getSchema(editorExtensions).nodeFromJSON(
    portableTextToProsemirror([gallery], { preserveIdentity: true }),
  );
  const document = editorPostSchema.shape.data.shape.document.parse(
    node.toJSON(),
  );
  assert.equal(
    preservesContent([gallery], prosemirrorToPortableText(document)),
    false,
  );
  assert.equal(
    preservesContent(
      [{ asset: { _ref: 'photo', _type: 'reference', provider: 'local' } }],
      [{ asset: { _ref: 'photo' } }],
    ),
    true,
  );
});
