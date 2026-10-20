// Only native display previews participate. Demo, external, and owner URLs keep
// their existing delivery path; callers never turn arbitrary URLs into sources.
const imageWidths = [320, 480, 800, 1120, 1600];
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const assetId = '[0-7][0-9A-HJKMNP-TV-Z]{25}';
const fileSource = new RegExp(
  `^/_emdash/api/media/file/trip/(${uuid})/(photo|poster)\\.jpg$`,
);
const assetSource = new RegExp(
  `^/_emdash/api/media/asset/(${assetId})/[^/?#]+$`,
);
export const displayPreviewKey = new RegExp(
  `^trip/${uuid}/(photo|poster)\\.jpg$`,
);
export const previewPath = new RegExp(
  `^/media-preview/(asset/(${assetId})|file/(${uuid})/(photo|poster)\\.jpg)/(320|480|800|1120|1600)/(auto|jpeg|webp)$`,
);

export function responsiveImage(source: string, sizes: string) {
  const file = fileSource.exec(source);
  const asset = assetSource.exec(source);
  const folder = file?.[1];
  const filename = file?.[2];
  const id = asset?.[1];
  const reference =
    folder && filename
      ? `file/${folder}/${filename}.jpg`
      : id
        ? `asset/${id}`
        : undefined;
  if (!reference) return { src: source };
  return {
    src: source,
    srcSet: imageWidths
      .map(
        (width) =>
          `/media-preview/${reference}/${String(width)}/auto ${String(width)}w`,
      )
      .join(', '),
    sizes,
  };
}

// These expressions follow Site's 1400px content limit and its 16/24px padding.
export const cardImageSizes =
  '(min-width: 1400px) 440px, (min-width: 901px) calc((100vw - 84px) / 3), (min-width: 601px) calc((100vw - 66px) / 2), calc(100vw - 34px)';
export const galleryImageSizes =
  '(min-width: 1400px) 446px, (min-width: 901px) calc((100vw - 62px) / 3), (min-width: 601px) calc((100vw - 55px) / 2), calc(100vw - 32px)';
export const postImageSizes =
  '(min-width: 848px) 800px, (min-width: 601px) calc(100vw - 48px), calc(100vw - 32px)';
