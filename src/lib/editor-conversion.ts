import { z } from 'zod';
import {
  portableTextToProsemirror,
  prosemirrorToPortableText,
  type ProseMirrorDocument,
  type ProseMirrorNode,
} from 'emdash';

const array = z.array(z.unknown());
const record = z.record(z.string(), z.unknown());
const emptyTextBlock = z.object({
  _type: z.literal('block'),
  _key: z.string(),
  children: z.tuple([
    z.object({
      _type: z.literal('span'),
      _key: z.string(),
      text: z.literal(''),
      marks: z.array(z.string()).max(0).optional(),
    }),
  ]),
});

function visitNodes(
  nodes: ProseMirrorNode[],
  visit: (node: ProseMirrorNode) => void,
) {
  for (const node of nodes) {
    visit(node);
    if (node.content) visitNodes(node.content, visit);
  }
}

// ProseMirror cannot contain empty text nodes. Retain the single empty span's
// key on its paragraph instead, and restore it only while that paragraph is empty.
export function toEditorDocument(
  blocks: Parameters<typeof portableTextToProsemirror>[0],
) {
  const emptyKeys = new Map<string, string>();
  for (const block of blocks) {
    const empty = emptyTextBlock.safeParse(block);
    if (empty.success)
      emptyKeys.set(empty.data._key, empty.data.children[0]._key);
  }
  const document = portableTextToProsemirror(blocks, {
    preserveIdentity: true,
  });
  visitNodes(document.content, (node) => {
    const key = node.attrs?.emdashPortableTextKey;
    if (typeof key !== 'string' || node.content?.length) return;
    const spanKey = emptyKeys.get(key);
    if (spanKey) node.attrs = { ...node.attrs, tripEmptySpanKey: spanKey };
  });
  return document;
}

export function fromEditorDocument(document: ProseMirrorDocument) {
  const emptyKeys = new Map<string, string>();
  visitNodes(document.content, (node) => {
    const key = node.attrs?.emdashPortableTextKey;
    const spanKey = node.attrs?.tripEmptySpanKey;
    if (
      !node.content?.length &&
      typeof key === 'string' &&
      typeof spanKey === 'string'
    )
      emptyKeys.set(key, spanKey);
  });
  return prosemirrorToPortableText(document).map((block) => {
    const empty = emptyTextBlock.safeParse(block);
    const spanKey = emptyKeys.get(block._key);
    if (!empty.success || !spanKey) return block;
    return {
      ...block,
      children: [{ ...empty.data.children[0], _key: spanKey }],
    };
  });
}

// Reject editing when conversion or the actual editor schema drops stored data.
// The reference type marker and an explicit local provider are equivalent to
// the converter's default local reference, so those two metadata fields may
// be omitted without changing the referenced asset. Empty text marks and block
// mark definitions also mean the same thing as their omitted defaults.
export function preservesContent(
  original: unknown,
  restored: unknown,
): boolean {
  const originalArray = array.safeParse(original);
  if (originalArray.success) {
    const restoredArray = array.safeParse(restored);
    return (
      restoredArray.success &&
      originalArray.data.length === restoredArray.data.length &&
      originalArray.data.every((value, index) =>
        preservesContent(value, restoredArray.data[index]),
      )
    );
  }
  const originalRecord = record.safeParse(original);
  if (originalRecord.success) {
    const restoredRecord = record.safeParse(restored);
    if (!restoredRecord.success) return false;
    const reference = typeof originalRecord.data._ref === 'string';
    return Object.entries(originalRecord.data).every(
      ([key, value]) =>
        value === undefined ||
        (reference && key === '_type' && value === 'reference') ||
        (reference && key === 'provider' && value === 'local') ||
        (restoredRecord.data[key] === undefined &&
          Array.isArray(value) &&
          value.length === 0 &&
          ((originalRecord.data._type === 'span' && key === 'marks') ||
            (originalRecord.data._type === 'block' && key === 'markDefs'))) ||
        preservesContent(value, restoredRecord.data[key]),
    );
  }
  return Object.is(original, restored);
}
