import { Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { z } from 'zod';

const TripImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      mediaId: { default: null, rendered: false },
      provider: { default: 'local', rendered: false },
      ...Object.fromEntries(
        [
          'caption',
          'width',
          'height',
          'displayWidth',
          'displayHeight',
          'alignment',
          'link',
        ].map((name) => [name, { default: null, rendered: false }]),
      ),
    };
  },
});
const TripVideo = Node.create({
  name: 'videoBlock',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      src: { default: '' },
      mediaId: { default: null },
      provider: { default: 'local' },
      caption: { default: '', rendered: false },
      width: { default: null },
      height: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: 'video[src]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'video',
      mergeAttributes(HTMLAttributes, { controls: '', playsinline: '' }),
    ];
  },
});
const TripGallery = Node.create({
  name: 'gallery',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      images: { default: [], rendered: false },
      columns: { default: null, rendered: false },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-trip-gallery]' }];
  },
  renderHTML({ node }) {
    const images = z
      .array(
        z.object({
          asset: z.object({ url: z.string().optional() }),
          alt: z.string().optional(),
        }),
      )
      .safeParse(node.attrs.images);
    const children: ['img', { src: string; alt: string }][] = images.success
      ? images.data.map((image) => [
          'img',
          { src: image.asset.url || '', alt: image.alt || '' },
        ])
      : [];
    return [
      'div',
      { 'data-trip-gallery': '', class: 'grid grid-cols-2 gap-2' },
      ...children,
    ];
  },
});
export const editorExtensions = [StarterKit, TripImage, TripVideo, TripGallery];
