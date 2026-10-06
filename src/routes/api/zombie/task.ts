import { createFileRoute } from '@tanstack/react-router';

import { evolinkFromConfigs } from '@/core/ai/evolink';
import { getAuth } from '@/core/auth';
import { AITaskStatus, findTask } from '@/modules/ai-tasks/service';
import { getAllConfigs } from '@/modules/config/service';
import { respData, respErr } from '@/lib/resp';

import { advance, PIPELINE_MODEL, taskView } from './-pipeline';

// Poll a clip task; each poll advances the pipeline one step if possible.
async function GET({ request }: { request: Request }) {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return respErr('Unauthorized');

    const id = new URL(request.url).searchParams.get('id');
    if (!id) return respErr('id is required');

    const task = await findTask(id);
    if (
      !task ||
      task.userId !== session.user.id ||
      task.model !== PIPELINE_MODEL
    ) {
      return respErr('Task not found');
    }

    if (
      task.status === AITaskStatus.SUCCESS ||
      task.status === AITaskStatus.FAILED
    ) {
      return respData(taskView(task));
    }

    const configs = await getAllConfigs();
    const provider = evolinkFromConfigs(configs);
    if (!provider) return respData(taskView(task));
    return respData(await advance(task.id, provider));
  } catch (error: any) {
    return respErr(error?.message || 'Query failed');
  }
}

export const Route = createFileRoute('/api/zombie/task')({
  server: { handlers: { GET } },
});
