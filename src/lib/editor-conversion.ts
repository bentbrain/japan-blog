import { z } from 'zod';

const array = z.array(z.unknown());
const record = z.record(z.string(), z.unknown());

// Reject editing when conversion or the actual editor schema drops stored data.
// The reference type marker and an explicit local provider are equivalent to
// the converter's default local reference, so those two metadata fields may
// be omitted without changing the referenced asset.
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
        preservesContent(value, restoredRecord.data[key]),
    );
  }
  return Object.is(original, restored);
}
