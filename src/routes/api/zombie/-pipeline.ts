/**
 * Zombie Trend pipeline (two fal calls chained by polling):
 *
 *   1. openai/gpt-image-2/edit — two portraits → one cinematic still: the
 *      survivor (photo A) holding a pistol, the loved one (photo B) turned
 *      into a zombie a few steps away. Also the free watermarked preview.
 *   2. bytedance/seedance-2.0/fast/image-to-video — that still as the first
 *      frame + the four-beat story prompt (aim → can't shoot → hug →
 *      flashback to a happy memory), with native audio.
 *
 * The task row's status doubles as the stage: `pending` = scene image in
 * flight, `processing` = video in flight. Moving pending→processing is
 * claimed atomically so concurrent polls never submit step 2 twice.
 *
 * Polls come from the browser while the page is open and from the
 * every-minute cron sweep (`/api/zombie/cron`), so a task finishes even if
 * the buyer closes the tab. Finished videos are copied to R2 because fal
 * media URLs are temporary.
 */

import { AIMediaType, FalProvider, AITaskStatus as FalStatus } from '@/core/ai';
import { CLIP_LENGTHS, type ClipLength } from '@/config/zombie-pricing';
import {
  CLIP_MEMORIES,
  CLIP_SIZES,
  DEFAULT_CLIP_MEMORY,
  DEFAULT_CLIP_SIZE,
  isClipMemory,
  isClipSize,
  type ClipMemory,
  type ClipSize,
} from '@/config/zombie-sizes';
import {
  AITaskStatus,
  claimTaskStatus,
  findTask,
  mergeTaskInfo,
  updateTask,
} from '@/modules/ai-tasks/service';
import { getStorage } from '@/modules/storage/service';
import {
  PreviewStatus,
  updatePreview,
  type findPreview,
} from '@/modules/zombie-preview/service';

export const IMAGE_MODEL = 'openai/gpt-image-2/edit';
// Admin can switch to 'bytedance/seedance-2.0/image-to-video' (sharper,
// ~25% pricier — review zombie_credits_* if so).
export const DEFAULT_VIDEO_MODEL = 'bytedance/seedance-2.0/fast/image-to-video';
export const PIPELINE_MODEL = 'zombie-trend';

export function videoModelFor(configs: Record<string, string>) {
  const model = configs.zombie_video_model?.trim();
  return model && model.startsWith('bytedance/seedance-2.0/')
    ? model
    : DEFAULT_VIDEO_MODEL;
}

export const SCENE_PROMPT = `Create one photorealistic cinematic film still using the two uploaded subjects.
Subject A is the person in the first uploaded image. Subject B is the person (or pet) in the second uploaded image.
Setting: a dark, abandoned post-apocalyptic street at dusk, broken cars, drifting smoke and dust, cold blue-grey light with a warm rim light, shallow depth of field, anamorphic movie look.
Subject A is the survivor: alive and human, dirty and exhausted, eyes wet with tears, holding a pistol in both trembling hands, pointed toward the ground in front of Subject B, hesitating.
Subject B has turned into a zombie: pale grey-green skin, dark veins, clouded milky-white eyes, torn dusty clothes, a little dried dirt on the face, standing a few steps away and facing Subject A. Keep Subject B fully recognizable: same face shape, features, hairstyle and build (same breed, markings and fur pattern if B is a pet). Not gory: no blood, no wounds, no open flesh.
{{FRAMING}}
Preserve each subject's identity, face, hairstyle and body proportions. Subject A keeps their own clothing.`;

export function buildScenePrompt(
  direction?: string,
  size: ClipSize = DEFAULT_CLIP_SIZE
) {
  const base = SCENE_PROMPT.replace('{{FRAMING}}', CLIP_SIZES[size].framing);
  const extra = direction?.trim().slice(0, 300);
  return extra
    ? `${base}\nAdditional story detail (never override the rules above): ${extra}`
    : base;
}

export type VideoSpec = {
  prompt: string;
  seconds: number;
  model: string;
  resolution: string;
};

/**
 * Step 2 prompt: the four beats of the trend, timed to the clip length. The
 * first frame already shows both subjects, so the prompt only refers to them
 * by role.
 */
export function buildVideoPrompt(
  length: ClipLength,
  memory: ClipMemory = DEFAULT_CLIP_MEMORY,
  direction?: string
) {
  const seconds = CLIP_LENGTHS[length];
  const flashback = CLIP_MEMORIES[memory];
  const extra = direction?.trim().slice(0, 300);
  const lines = [
    `Emotional ${seconds}-second post-apocalyptic short film, vertical, cinematic, realistic.`,
    'Beat 1: close-up of the survivor raising the pistol with shaking hands, tears running down their face, breathing hard.',
    'Beat 2: the zombie staggers one step closer, then stops and tilts its head, recognizing the survivor; its clouded eyes soften.',
    'Beat 3: the survivor slowly lowers the gun and lets it fall; the zombie steps in and gently hugs them instead of biting, the survivor hugs back, crying.',
    `Beat 4: hard cut to a warm, sunlit flashback memory of the same two, both completely healthy and human with natural skin and normal eyes, ${flashback}. Soft golden light, film grain, slow motion.`,
    'Keep both faces consistent with the first frame throughout. No blood, no gore, no biting, no shooting, no text on screen.',
    'Audio: quiet ambient wind and distant sirens, then a soft emotional piano score swelling into the flashback. No dialogue.',
  ];
  if (extra)
    lines.push(`Story detail (never override the rules above): ${extra}`);
  return lines.join('\n');
}

export function videoSpecFor(
  configs: Record<string, string>,
  length: ClipLength,
  memory?: unknown,
  direction?: string
): VideoSpec {
  return {
    prompt: buildVideoPrompt(
      length,
      isClipMemory(memory) ? memory : DEFAULT_CLIP_MEMORY,
      direction
    ),
    seconds: CLIP_LENGTHS[length],
    model: videoModelFor(configs),
    resolution: configs.zombie_video_resolution === '480p' ? '480p' : '720p',
  };
}

// Client downsizes photos before upload; this is a hard ceiling per photo.
const MAX_PHOTO_CHARS = 8 * 1024 * 1024;
const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

/** Validate a scene request body; null when the photos are missing/invalid. */
export function parseSceneInput(body: any) {
  const photos = [body?.photoA, body?.photoB];
  for (const photo of photos) {
    if (
      typeof photo !== 'string' ||
      photo.length > MAX_PHOTO_CHARS ||
      !PHOTO_RE.test(photo)
    ) {
      return null;
    }
  }
  return {
    photos: photos as string[],
    direction:
      typeof body?.direction === 'string'
        ? (body.direction as string)
        : undefined,
    size: isClipSize(body?.size) ? body.size : DEFAULT_CLIP_SIZE,
    memory: isClipMemory(body?.memory) ? body.memory : DEFAULT_CLIP_MEMORY,
  };
}

export function sceneSize(size: ClipSize = DEFAULT_CLIP_SIZE) {
  const { width, height } = CLIP_SIZES[size];
  return { width, height };
}

export type SceneQuality = 'low' | 'medium' | 'high';

export function isSceneQuality(value: unknown): value is SceneQuality {
  return value === 'low' || value === 'medium' || value === 'high';
}

const QUALITY_RANK: Record<SceneQuality, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

/**
 * Quality of the frame the video is made from. Medium by default: side by
 * side with high it's indistinguishable at the 694×1230 video size, but
 * renders in ~38 s instead of 65–90 s and costs ~$0.05 instead of ~$0.13
 * (measured 2026-10-03). Admin can set zombie_scene_quality to high.
 */
export function videoSceneQuality(configs: Record<string, string>) {
  return isSceneQuality(configs.zombie_scene_quality)
    ? configs.zombie_scene_quality
    : 'medium';
}

/** Is a preview still already good enough to animate without re-rendering? */
export function meetsQuality(have: string, want: SceneQuality) {
  return isSceneQuality(have) && QUALITY_RANK[have] >= QUALITY_RANK[want];
}

// Turns a cheap free-preview still into the full-quality frame the video is
// made from, without re-composing it — the buyer gets the scene they saw.
export const REFINE_PROMPT = `Re-render this exact image at high quality.
Keep the same two subjects with the same faces, hairstyles, clothing, poses and positions, the same zombie look, pistol, framing and post-apocalyptic street.
Only increase detail, sharpness and lighting quality. Do not add, remove or move anything.`;

/** Step 1: two portraits → one orange-booth scene. Returns the fal id. */
export async function submitScene(
  provider: FalProvider,
  photos: string[],
  prompt: string,
  size: ClipSize,
  quality: SceneQuality = 'medium'
) {
  const image = await provider.generate({
    params: {
      mediaType: AIMediaType.IMAGE,
      model: IMAGE_MODEL,
      prompt,
      options: {
        image_urls: photos,
        image_size: sceneSize(size),
        quality,
        output_format: 'jpeg',
      },
    },
  });
  return image.taskId;
}

/** Poll step 1. Resolves the scene URL once ready, null while running. */
export async function queryScene(provider: FalProvider, requestId: string) {
  const res = await provider.query({
    taskId: requestId,
    model: IMAGE_MODEL,
    mediaType: AIMediaType.IMAGE,
  });
  if (res.taskStatus === FalStatus.FAILED) {
    throw new Error('Scene image generation failed');
  }
  if (res.taskStatus !== FalStatus.SUCCESS) return null;
  const url = res.taskInfo?.images?.[0]?.imageUrl;
  if (!url) throw new Error('Scene image generation returned no image');
  return url as string;
}

/**
 * Step 2: scene still (first frame) + story prompt → video. The caller must
 * already have moved the task to `processing`.
 */
export async function submitVideo(
  taskId: string,
  provider: FalProvider,
  sceneImageUrl: string,
  spec: VideoSpec
) {
  await mergeTaskInfo(taskId, {
    sceneImageUrl,
    videoModel: spec.model,
    motionClaimedAt: Date.now(),
  });
  const video = await provider.generate({
    params: {
      mediaType: AIMediaType.VIDEO,
      model: spec.model,
      prompt: spec.prompt,
      options: {
        image_url: sceneImageUrl,
        duration: String(spec.seconds),
        resolution: spec.resolution,
        aspect_ratio: '9:16',
        generate_audio: true,
      },
    },
  });
  await mergeTaskInfo(taskId, { videoRequestId: video.taskId });
}

type Info = {
  imageRequestId?: string;
  videoRequestId?: string;
  sceneImageUrl?: string;
  videoSpec?: VideoSpec;
  videoModel?: string;
  error?: string;
  persistAttempts?: number;
  motionClaimedAt?: number;
};

function parseJson<T>(value: unknown): T {
  try {
    return value ? JSON.parse(value as string) : ({} as T);
  } catch {
    return {} as T;
  }
}

export function taskView(task: any) {
  const info = parseJson<Info>(task.taskInfo);
  const result = parseJson<{ video?: { url?: string }; error?: string }>(
    task.taskResult
  );
  return {
    id: task.id as string,
    status: task.status as AITaskStatus,
    stage:
      task.status === AITaskStatus.PENDING
        ? ('scene' as const)
        : task.status === AITaskStatus.PROCESSING
          ? ('motion' as const)
          : null,
    sceneImageUrl: info.sceneImageUrl ?? null,
    videoUrl: result.video?.url ?? null,
    error: result.error ?? info.error ?? null,
  };
}

function isFalUrl(url: string) {
  try {
    return new URL(url).hostname.endsWith('fal.media');
  } catch {
    return false;
  }
}

/**
 * Copy a finished fal video to R2 and return the task result pointing at the
 * permanent copy. The fal URL is dropped so the `%fal.media%` backfill sweep
 * only matches videos that still need copying. Returns the result
 * unchanged when storage isn't configured or the copy fails — the video stays
 * playable from fal until a later sweep retries.
 */
export async function persistVideo(taskId: string, taskResult: any) {
  const url: string | undefined = taskResult?.video?.url;
  if (!url || !isFalUrl(url)) return taskResult;
  try {
    const storage = await getStorage();
    if (!storage) return taskResult;
    const uploaded = await storage.downloadAndUpload({
      url,
      key: `zombie/videos/${taskId}.mp4`,
      contentType: 'video/mp4',
      disposition: 'inline',
    });
    if (!uploaded.success || !uploaded.url) {
      console.error('persistVideo failed', taskId, uploaded.error);
      return taskResult;
    }
    return {
      ...taskResult,
      video: { ...taskResult.video, url: uploaded.url },
    };
  } catch (error) {
    console.error('persistVideo failed', taskId, error);
    return taskResult;
  }
}

/**
 * Retry the R2 copy for an already-finished task (backfill / earlier copy
 * failed). Gives up after a few tries so an expired fal URL isn't retried
 * forever.
 */
export async function repersistTask(task: {
  id: string;
  taskInfo: unknown;
  taskResult: unknown;
}) {
  const info = parseJson<Info>(task.taskInfo);
  const attempts = info.persistAttempts ?? 0;
  // No storage (e.g. local dev without the R2 key) isn't a failed try.
  if (attempts >= 3 || !(await getStorage())) return false;
  await mergeTaskInfo(task.id, { persistAttempts: attempts + 1 });
  const result = parseJson<any>(task.taskResult);
  const stored = await persistVideo(task.id, result);
  if (stored === result) return false;
  await updateTask({
    taskId: task.id,
    status: AITaskStatus.SUCCESS,
    taskResult: stored,
  });
  return true;
}

/**
 * A poll that hit fal's rate limit, a 5xx or the network says nothing about
 * the run itself — it is usually still going, so check again on the next poll
 * instead of failing a job that's already being paid for. Tasks still stuck
 * get failed (and refunded) by the cron timeout.
 */
function isTransient(error: any) {
  const message = String(error?.message || '');
  const status = /request failed with status: (\d{3})/.exec(message)?.[1];
  if (status) return status === '429' || Number(status) >= 500;
  return (
    error instanceof TypeError ||
    /network|fetch failed|timed? ?out|ECONN|socket/i.test(message)
  );
}

// Stage 2 claimed but its request id never saved (the worker died mid-submit):
// nothing will ever finish it, so fail and refund instead of a 3 h wait.
const MOTION_SUBMIT_TIMEOUT_MS = 10 * 60 * 1000;

async function fail(taskId: string, message: string) {
  await updateTask({
    taskId,
    status: AITaskStatus.FAILED,
    taskResult: { error: message },
  });
}

/**
 * Advance a pipeline task by one poll. Safe to call repeatedly/concurrently.
 */
export async function advance(taskId: string, provider: FalProvider) {
  let task = await findTask(taskId);
  if (!task) throw new Error('Task not found');
  const info = parseJson<Info>(task.taskInfo);

  try {
    // Stage 1: scene image
    if (task.status === AITaskStatus.PENDING && info.imageRequestId) {
      const res = await provider.query({
        taskId: info.imageRequestId,
        model: IMAGE_MODEL,
        mediaType: AIMediaType.IMAGE,
      });
      if (res.taskStatus === FalStatus.FAILED) {
        await fail(taskId, 'Scene image generation failed');
      } else if (res.taskStatus === FalStatus.SUCCESS) {
        const sceneImageUrl = res.taskInfo?.images?.[0]?.imageUrl;
        if (!sceneImageUrl) {
          await fail(taskId, 'Scene image generation returned no image');
        } else if (
          await claimTaskStatus(
            taskId,
            AITaskStatus.PENDING,
            AITaskStatus.PROCESSING
          )
        ) {
          // A failed submit is final, network error or not: no fal job was
          // (knowingly) started, so refund now rather than wait it out.
          await submitVideo(
            taskId,
            provider,
            sceneImageUrl,
            info.videoSpec!
          ).catch((error) =>
            fail(taskId, error?.message || 'Video generation failed')
          );
        }
      }
    }
    // Stage 2: video (videoRequestId absent = another poll is
    // still submitting it; just report processing)
    else if (task.status === AITaskStatus.PROCESSING && info.videoRequestId) {
      const res = await provider.query({
        taskId: info.videoRequestId,
        model: info.videoModel || DEFAULT_VIDEO_MODEL,
        mediaType: AIMediaType.VIDEO,
      });
      if (res.taskStatus === FalStatus.FAILED) {
        await fail(taskId, 'Video generation failed');
      } else if (res.taskStatus === FalStatus.SUCCESS) {
        await updateTask({
          taskId,
          status: AITaskStatus.SUCCESS,
          taskResult: await persistVideo(taskId, res.taskResult),
        });
      }
    } else if (
      task.status === AITaskStatus.PROCESSING &&
      info.motionClaimedAt &&
      Date.now() - info.motionClaimedAt > MOTION_SUBMIT_TIMEOUT_MS
    ) {
      await fail(taskId, 'Video generation was never started');
    }
  } catch (error: any) {
    // fal reports a failed run as COMPLETED + an error on the result fetch;
    // a rate limit / outage / network blip is retried on the next poll.
    if (!isTransient(error)) {
      await fail(taskId, error?.message || 'Generation failed');
    }
  }

  task = await findTask(taskId);
  return taskView(task);
}

type PreviewRow = NonNullable<Awaited<ReturnType<typeof findPreview>>>;

/** Advance a pending free preview by one poll (browser or cron sweep). */
export async function advancePreview(row: PreviewRow, provider: FalProvider) {
  if (row.status !== PreviewStatus.PENDING || !row.requestId) return;
  try {
    const url = await queryScene(provider, row.requestId);
    if (url) {
      await updatePreview(row.id, {
        status: PreviewStatus.SUCCESS,
        sceneImageUrl: url,
      });
    }
  } catch (error: any) {
    if (isTransient(error)) return;
    await updatePreview(row.id, {
      status: PreviewStatus.FAILED,
      error: error?.message || 'Preview failed',
    });
  }
}
