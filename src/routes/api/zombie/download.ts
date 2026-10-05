import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import { AITaskStatus, findTask } from '@/modules/ai-tasks/service';
import { respErr } from '@/lib/resp';

import { PIPELINE_MODEL, taskView } from './-pipeline';

// Same-origin download of a finished clip video. The file lives on another
// origin (R2 / fal), where the browser ignores <a download>, so it's streamed
// through here with an attachment Content-Disposition.
async function GET({ request }: { request: Request }) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session?.user) return respErr('Unauthorized');

  const id = new URL(request.url).searchParams.get('id');
  const task = id ? await findTask(id) : undefined;
  if (
    !task ||
    task.userId !== session.user.id ||
    task.model !== PIPELINE_MODEL ||
    task.status !== AITaskStatus.SUCCESS
  ) {
    return respErr('Video not found');
  }

  const { videoUrl } = taskView(task);
  if (!videoUrl) return respErr('Video not found');

  const upstream = await fetch(videoUrl);
  if (!upstream.ok || !upstream.body) return respErr('Video is unavailable');

  const date = new Date(task.createdAt).toISOString().slice(0, 10);
  const headers = new Headers({
    'Content-Type': 'video/mp4',
    'Content-Disposition': `attachment; filename="zombietrend-${date}-${task.id.slice(0, 8)}.mp4"`,
    'Cache-Control': 'private, no-store',
  });
  const length = upstream.headers.get('content-length');
  if (length) headers.set('Content-Length', length);
  return new Response(upstream.body, { headers });
}

export const Route = createFileRoute('/api/zombie/download')({
  server: { handlers: { GET } },
});
