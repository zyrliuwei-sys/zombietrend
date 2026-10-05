import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import { getUserTasksPage } from '@/modules/ai-tasks/service';
import { respData, respErr } from '@/lib/resp';

import { PIPELINE_MODEL, taskView } from './-pipeline';

// The signed-in user's clip videos, newest first (settings → My videos).
async function GET({ request }: { request: Request }) {
  try {
    const session = await getAuth().api.getSession({
      headers: request.headers,
    });
    if (!session?.user) return respErr('Unauthorized');

    const params = new URL(request.url).searchParams;
    const page = Math.max(1, Number(params.get('page')) || 1);
    const pageSize = Math.min(
      48,
      Math.max(1, Number(params.get('pageSize')) || 12)
    );

    const { items, total } = await getUserTasksPage({
      userId: session.user.id,
      model: PIPELINE_MODEL,
      page,
      pageSize,
    });
    return respData({
      items: items.map((task) => ({
        ...taskView(task),
        createdAt: new Date(task.createdAt).toISOString(),
      })),
      total,
    });
  } catch (error: any) {
    return respErr(error?.message || 'Query failed');
  }
}

export const Route = createFileRoute('/api/zombie/videos')({
  server: { handlers: { GET } },
});
