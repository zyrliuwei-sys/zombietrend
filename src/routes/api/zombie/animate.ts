import { createFileRoute } from '@tanstack/react-router';

import { AIMediaType } from '@/core/ai';
import { evolinkFromConfigs } from '@/core/ai/evolink';
import { getAuth } from '@/core/auth';
import {
  DEFAULT_CLIP_LENGTH,
  isClipLength,
  resolveClipCreditsFor,
} from '@/config/zombie-pricing';
import {
  DEFAULT_CLIP_SIZE,
  isClipSize,
  OFFERED_CLIP_SIZES,
  type ClipSize,
} from '@/config/zombie-sizes';
import {
  AITaskStatus,
  claimTaskStatus,
  createTask,
  findTask,
  mergeTaskInfo,
  updateTask,
} from '@/modules/ai-tasks/service';
import { getAllConfigs } from '@/modules/config/service';
import { screenPrompt } from '@/modules/content-safety/service';
import { getBalance } from '@/modules/credits/service';
import { hasPermission } from '@/modules/rbac/service';
import {
  claimPreview,
  findPreview,
  PreviewStatus,
} from '@/modules/zombie-preview/service';
import { respData, respErr } from '@/lib/resp';

import { DIRECTION_BLOCKED, isBlockedDirection } from './-direction-filter';
import {
  meetsQuality,
  PIPELINE_MODEL,
  REFINE_PROMPT,
  submitScene,
  submitVideo,
  taskView,
  videoSceneQuality,
  videoSpecFor,
} from './-pipeline';

// Evolink media links expire after 24 h; leave margin for the refine step.
const PREVIEW_MAX_AGE_MS = 23 * 60 * 60 * 1000;

// Paid step for a free preview: re-render its still at video quality (skipped
// if the preview already is that good), then make the video. Same price
// as a full run — that price already covers a high-quality scene.
async function POST({ request }: { request: Request }) {
  try {
    const session = await getAuth().api.getSession({
      headers: request.headers,
    });
    if (!session?.user) return respErr('Unauthorized');
    const userId = session.user.id;

    const body = await request.json().catch(() => ({}));
    const previewId = typeof body?.previewId === 'string' ? body.previewId : '';
    const preview = previewId ? await findPreview(previewId) : undefined;
    if (
      !preview ||
      preview.status !== PreviewStatus.SUCCESS ||
      !preview.sceneImageUrl
    ) {
      return respErr('Preview not found');
    }

    // Already animated (double click, or back after a reload): hand back
    // that task instead of charging again.
    if (preview.taskId) {
      const existing = await findTask(preview.taskId);
      if (existing && existing.userId === userId) {
        return respData(taskView(existing));
      }
      return respErr('Preview already used');
    }

    // Framings no longer offered (1:1, 3:4, 16:9) animate badly against the
    // 9:16 clip, and Evolink's still link dies after 24 h (the refine/video
    // job would fail on it) — ask for a fresh preview instead of charging.
    if (
      !OFFERED_CLIP_SIZES.includes(preview.size as ClipSize) ||
      Date.now() - new Date(preview.createdAt).getTime() > PREVIEW_MAX_AGE_MS
    ) {
      return respErr('Preview expired, please make a new one');
    }

    const configs = await getAllConfigs();
    const isAdmin = await hasPermission(userId, 'admin.*');
    const length = isClipLength(body?.length)
      ? body.length
      : DEFAULT_CLIP_LENGTH;
    const price = resolveClipCreditsFor(configs, length);
    if (!isAdmin && (await getBalance(userId)) < price) {
      return respErr('Insufficient credits');
    }
    const provider = evolinkFromConfigs(configs);
    if (!provider) return respErr('Generation is not configured');
    const direction =
      typeof body?.direction === 'string' ? body.direction : undefined;
    if (isBlockedDirection(direction)) return respErr(DIRECTION_BLOCKED);
    if (!(await screenPrompt(direction, configs)).allowed) {
      return respErr(DIRECTION_BLOCKED);
    }
    // The preview's scene was composed for its style; the video must match.
    const videoSpec = videoSpecFor(
      configs,
      length,
      body?.memory,
      direction,
      preview.style
    );

    const task = await createTask({
      userId,
      mediaType: AIMediaType.VIDEO,
      provider: 'evolink',
      model: PIPELINE_MODEL,
      prompt: `Animate free preview ${preview.id}`,
      costCredits: isAdmin ? 0 : price,
    });

    if (!(await claimPreview(preview.id, userId, task.id))) {
      // Lost a race with a concurrent click: refund this task.
      await updateTask({
        taskId: task.id,
        status: AITaskStatus.FAILED,
        taskResult: { error: 'Preview already used' },
      });
      return respErr('Preview already used');
    }

    try {
      const quality = videoSceneQuality(configs);
      if (meetsQuality(preview.quality, quality)) {
        await claimTaskStatus(
          task.id,
          AITaskStatus.PENDING,
          AITaskStatus.PROCESSING
        );
        await submitVideo(task.id, provider, preview.sceneImageUrl, videoSpec);
      } else {
        // Cheap preview still → re-render at video quality, then the regular
        // pipeline (task polling) makes the video from that frame.
        const size = isClipSize(preview.size)
          ? preview.size
          : DEFAULT_CLIP_SIZE;
        const imageRequestId = await submitScene(
          provider,
          [preview.sceneImageUrl],
          REFINE_PROMPT,
          size,
          quality
        );
        await mergeTaskInfo(task.id, { imageRequestId, videoSpec });
      }
    } catch (error: any) {
      await updateTask({
        taskId: task.id,
        status: AITaskStatus.FAILED,
        taskResult: { error: error?.message },
      });
      throw error;
    }

    return respData(taskView((await findTask(task.id))!));
  } catch (error: any) {
    return respErr(error?.message || 'Animate failed');
  }
}

export const Route = createFileRoute('/api/zombie/animate')({
  server: { handlers: { POST } },
});
