import {
  Input,
  BlobSource,
  ALL_FORMATS,
  Output,
  Mp4OutputFormat,
  BufferTarget,
  Conversion,
  Quality,
} from 'mediabunny';

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Could not prepare image'));
      },
      'image/jpeg',
      0.9,
    );
  });
}
export async function prepareMedia(file: File) {
  const video =
    file.type.startsWith('video/') || /\.(mov|mp4|m4v)$/i.test(file.name);
  const canvas = document.createElement('canvas'),
    ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  if (video) {
    const input = new Input({
      source: new BlobSource(file),
      formats: ALL_FORMATS,
    });
    try {
      const duration = await input.computeDuration();
      if (duration > 10.1)
        throw new Error('Videos must be 10 seconds or shorter');
      const output = new Output({
        format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
        target: new BufferTarget(),
      });
      const conversion = await Conversion.init({
        input,
        output,
        video: {
          codec: 'avc',
          width: 1280,
          quality: new Quality('high'),
          forceTranscode: true,
          frameRate: 30,
        },
        audio: { discard: true },
      });
      if (!conversion.isValid)
        throw new Error(
          'This browser cannot convert the video. Try Safari or Chrome.',
        );
      await conversion.execute();
      const buffer = output.target.buffer;
      if (!buffer) throw new Error('Could not prepare video');
      const display = new File([buffer], 'video.mp4', { type: 'video/mp4' }),
        element = document.createElement('video'),
        url = URL.createObjectURL(display);
      element.muted = true;
      element.playsInline = true;
      element.src = url;
      try {
        await new Promise<void>((resolve, reject) => {
          element.onloadeddata = () => {
            resolve();
          };
          element.onerror = () => {
            reject(new Error('Could not read video'));
          };
        });
        canvas.width = 1280;
        canvas.height = Math.round(
          (1280 * element.videoHeight) / element.videoWidth,
        );
        ctx.drawImage(element, 0, 0, canvas.width, canvas.height);
        return {
          display,
          poster: new File([await canvasBlob(canvas)], 'poster.jpg', {
            type: 'image/jpeg',
          }),
        };
      } finally {
        URL.revokeObjectURL(url);
        element.removeAttribute('src');
        element.load();
      }
    } finally {
      input.dispose();
    }
  }
  let source: Blob = file;
  if (/\.(heic|heif)$/i.test(file.name) || file.type.includes('hei')) {
    const { heicTo } = await import('heic-to/csp');
    source = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 });
  }
  const bitmap = await createImageBitmap(source);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const display = new File([await canvasBlob(canvas)], 'photo.jpg', {
    type: 'image/jpeg',
  });
  return { display, poster: display };
}
