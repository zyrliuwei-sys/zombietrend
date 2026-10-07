import { createFileRoute } from '@tanstack/react-router';

import { findPreview, PreviewStatus } from '@/modules/zombie-preview/service';

import { isHeld } from './-preview';
import { canWatermark, watermarkImage } from './-watermark';

// Streams a finished preview still from Evolink without exposing its URL,
// with the watermark burned in on the server (local dev without the Images
// binding gets the clean still).
async function GET({ request }: { request: Request }) {
  const id = new URL(request.url).searchParams.get('id');
  const row = id ? await findPreview(id) : undefined;
  if (
    !row ||
    row.status !== PreviewStatus.SUCCESS ||
    !row.sceneImageUrl ||
    isHeld(row)
  ) {
    return new Response('Not found', { status: 404 });
  }

  const upstream = await fetch(row.sceneImageUrl);
  if (!upstream.ok || !upstream.body) {
    return new Response('Preview expired', { status: 410 });
  }
  let body: ReadableStream | null = upstream.body;
  let contentType = upstream.headers.get('content-type') || 'image/jpeg';
  if (canWatermark()) {
    try {
      const marked = await watermarkImage(upstream.body);
      body = marked.body;
      contentType = 'image/jpeg';
    } catch (error) {
      // Never fall back to the clean frame in production.
      console.error('preview watermark failed', row.id, error);
      return new Response('Preview unavailable', { status: 503 });
    }
  }
  return new Response(body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=86400',
      'X-Robots-Tag': 'noindex',
    },
  });
}

export const Route = createFileRoute('/api/zombie/preview-image')({
  server: { handlers: { GET } },
});
