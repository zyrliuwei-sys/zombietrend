/**
 * Burns the "FREE PREVIEW" watermark into a free preview still on the server
 * (Cloudflare Images binding `IMAGES`), so the browser never receives a clean
 * frame — not even from the network tab.
 *
 * The overlay is a 720×1280 transparent PNG (src/assets/preview-watermark.png)
 * matching the 9:16 scene size; the still is fitted to that size first.
 */

import watermarkDataUrl from '@/assets/preview-watermark.png?inline';

const WIDTH = 720;
const HEIGHT = 1280;

function watermarkStream() {
  const base64 = watermarkDataUrl.slice(watermarkDataUrl.indexOf(',') + 1);
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new Response(bytes).body!;
}

function imagesBinding(): any {
  const g = globalThis as any;
  return (g.__CF_ENV__ ?? g.__env__)?.IMAGES;
}

/** True where the binding exists (production Worker); false in local dev. */
export function canWatermark() {
  return !!imagesBinding();
}

/** JPEG response of the still with the watermark burned in. */
export async function watermarkImage(image: ReadableStream<Uint8Array>) {
  const images = imagesBinding();
  const result = await images
    .input(image)
    .transform({ width: WIDTH, height: HEIGHT, fit: 'cover' })
    .draw(images.input(watermarkStream()), { top: 0, left: 0 })
    .output({ format: 'image/jpeg', quality: 82 });
  return result.response() as Response;
}
