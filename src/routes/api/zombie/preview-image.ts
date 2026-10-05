import { createFileRoute } from '@tanstack/react-router';

import { findPreview, PreviewStatus } from '@/modules/zombie-preview/service';

// Streams a finished preview still from fal without exposing its URL.
async function GET({ request }: { request: Request }) {
  const id = new URL(request.url).searchParams.get('id');
  const row = id ? await findPreview(id) : undefined;
  if (!row || row.status !== PreviewStatus.SUCCESS || !row.sceneImageUrl) {
    return new Response('Not found', { status: 404 });
  }

  const upstream = await fetch(row.sceneImageUrl);
  if (!upstream.ok || !upstream.body) {
    return new Response('Preview expired', { status: 410 });
  }
  return new Response(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') || 'image/jpeg',
      'Cache-Control': 'private, max-age=86400',
      'X-Robots-Tag': 'noindex',
    },
  });
}

export const Route = createFileRoute('/api/zombie/preview-image')({
  server: { handlers: { GET } },
});
