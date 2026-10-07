/**
 * Zombie Trend pipeline (two Evolink calls chained by polling):
 *
 *   1. gpt-image-2 — two portraits → one cinematic still: the
 *      survivor (photo A) holding a pistol, the loved one (photo B) turned
 *      into a zombie a few steps away. Also the free watermarked preview.
 *   2. seedance-2.0-fast-image-to-video — that still as the first
 *      frame + the story beats of the chosen style (gun: aim → can't shoot
 *      → hug; cure: injection → turns back → hug; glass: palms on the
 *      glass → goodbye), always ending on a flashback, with native audio.
 *
 * The task row's status doubles as the stage: `pending` = scene image in
 * flight, `processing` = video in flight. Moving pending→processing is
 * claimed atomically so concurrent polls never submit step 2 twice.
 *
 * Polls come from the browser while the page is open and from the
 * every-minute cron sweep (`/api/zombie/cron`), so a task finishes even if
 * the buyer closes the tab. Finished videos are copied to R2 because Evolink
 * media URLs expire after 24 h.
 */

import type { EvolinkProvider, EvolinkTask } from '@/core/ai/evolink';
import {
  CLIP_LENGTHS,
  videoResolutionFor,
  type ClipLength,
} from '@/config/zombie-pricing';
import {
  CLIP_MEMORIES,
  CLIP_SIZES,
  DEFAULT_CLIP_MEMORY,
  DEFAULT_CLIP_SIZE,
  DEFAULT_CLIP_STYLE,
  isClipMemory,
  isClipSize,
  isClipStyle,
  type ClipMemory,
  type ClipSize,
  type ClipStyle,
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

// Admin can switch to 'seedance-2.0-image-to-video' (sharper; credits are
// priced at the standard rate either way — see config/zombie-pricing.ts).
export const DEFAULT_VIDEO_MODEL = 'seedance-2.0-fast-image-to-video';
const VIDEO_MODELS = [
  'seedance-2.0-fast-image-to-video',
  'seedance-2.0-image-to-video',
];
export const PIPELINE_MODEL = 'zombie-trend';

export function videoModelFor(configs: Record<string, string>) {
  const model = configs.zombie_video_model?.trim();
  return model && VIDEO_MODELS.includes(model) ? model : DEFAULT_VIDEO_MODEL;
}

const ZOMBIE_LOOK = `pale grey-green skin, dark veins, clouded milky-white eyes, torn dusty clothes, a little dried dirt on the face. Keep Subject B fully recognizable: same face shape, features, hairstyle and build (same breed, markings and fur pattern if B is a pet). Not gory: no blood, no wounds, no open flesh.`;

type StyleSpec = {
  /** Setting + what each subject is doing in the scene still. */
  scene: string;
  /** Composition; replaces the size's default framing when set. */
  framing?: string;
  /** One-line logline that opens the video prompt. */
  logline: string;
  /** The beats before the flashback: [start, end) fractions + action. */
  beats: [number, number, string][];
  /** Where the flashback starts (fraction of the clip). */
  flashbackAt: number;
  safety: string;
  audio: string;
};

const STYLES: Record<ClipStyle, StyleSpec> = {
  // The original trend: aim → recognise → hug → flashback.
  gun: {
    scene: `Setting: a dark, abandoned post-apocalyptic street at dusk, broken cars, drifting smoke and dust, cold blue-grey light with a warm rim light, shallow depth of field, anamorphic movie look.
Subject A is the survivor: alive and human, dirty and exhausted, eyes wet with tears, holding a pistol in both trembling hands, pointed toward the ground in front of Subject B, hesitating.
Subject B has turned into a zombie, standing a few steps away and facing Subject A: ${ZOMBIE_LOOK}`,
    logline:
      'in the style of the viral "zombie trend": a survivor finds their loved one has turned into a zombie, cannot shoot them, and they share one last hug.',
    beats: [
      [
        0,
        0.25,
        'slow push-in on the survivor holding the pistol in both shaking hands, aimed low, tears running down their face, breathing hard; cold blue dusk light, drifting smoke.',
      ],
      [
        0.25,
        0.45,
        'the zombie staggers one step closer, then stops and tilts its head, recognizing the survivor; its clouded eyes soften.',
      ],
      [
        0.45,
        0.7,
        'the survivor lowers the gun and lets it drop to the ground; the zombie steps in and gently hugs them instead of attacking, the survivor hugs back, sobbing; the camera slowly circles the embrace.',
      ],
    ],
    flashbackAt: 0.7,
    safety: 'No blood, no gore, no biting, no shooting.',
    audio:
      'Audio: quiet wind and distant sirens, a shaky breath, then a soft emotional piano score that swells into the flashback. No dialogue.',
  },
  // Happy ending: the cure turns the loved one back.
  cure: {
    scene: `Setting: a ruined, abandoned hospital corridor at night, overturned gurneys, peeling walls, dust in the air, flickering cold fluorescent light mixed with a warm orange emergency lamp, shallow depth of field, anamorphic movie look.
Subject A is the survivor: alive and human, dirty and exhausted, eyes wet with tears, holding a small syringe filled with glowing blue cure in one hand, the other hand resting gently on Subject B's shoulder, about to give the injection in B's upper arm.
Subject B has turned into a zombie, standing very close and calm, facing Subject A: ${ZOMBIE_LOOK}`,
    framing:
      'Use a tall vertical 9:16 cinematic composition, both subjects framed from about the waist up, close together, the survivor in the near foreground on one side and the turned one facing them, the glowing blue syringe clearly visible between them.',
    logline:
      'a zombie love story with a hopeful ending: a survivor finds their loved one has turned into a zombie and brings them back with the last dose of a cure.',
    beats: [
      [
        0,
        0.25,
        'the survivor, hands shaking and crying, gently presses the glowing blue syringe to the upper arm of the calm zombie; the blue glow empties into the arm. No visible needle wound, no blood.',
      ],
      [
        0.25,
        0.5,
        'the zombie trembles and slowly transforms back: the grey-green skin warms to a natural healthy tone, the dark veins fade away, the milky eyes clear into normal human eyes, a soft blue glow spreading through the skin.',
      ],
      [
        0.5,
        0.7,
        'fully human again, the loved one blinks, recognizes the survivor and smiles; they embrace tightly, the survivor sobbing with relief; the camera slowly circles the embrace as warm light floods the corridor.',
      ],
    ],
    flashbackAt: 0.7,
    safety:
      'No blood, no gore, no biting, no visible needle wound, no weapons.',
    audio:
      'Audio: a flickering light hum and a shaky breath, a rising shimmer during the transformation, then a warm hopeful piano score that swells into the flashback. No dialogue.',
  },
  // Quiet goodbye through a window: no contact, no weapon.
  glass: {
    scene: `Setting: a rainy night outside an abandoned shop, a large glass door between the two subjects, rain streaks and water drops on the glass, a lonely street lamp and neon reflections, cold blue light outside and dim warm light inside, shallow depth of field, anamorphic movie look.
Subject A is the survivor: alive and human, inside the shop, dirty and exhausted, eyes wet with tears, pressing one open palm flat against the glass.
Subject B has turned into a zombie, outside in the rain on the other side of the glass, pressing their palm against the same spot, face close to the glass, looking at Subject A: ${ZOMBIE_LOOK}`,
    framing:
      'Use a tall vertical 9:16 cinematic composition: the glass pane runs vertically through the middle of the frame, Subject A inside on one side and Subject B outside in the rain on the other, both framed from about the chest up, their palms meeting on the glass at the center.',
    logline:
      'a zombie love story told through a glass door: a survivor and their loved one, now a zombie, say goodbye with their hands pressed together on either side of the glass.',
    beats: [
      [
        0,
        0.25,
        'rain runs down the glass; slow push-in on the two palms pressed together on either side of the glass, then on the survivor crying inside.',
      ],
      [
        0.25,
        0.45,
        'outside in the rain the zombie tilts its head, its clouded eyes soften with recognition; slowly both rest their foreheads against the glass at the same spot.',
      ],
      [
        0.45,
        0.7,
        'the zombie slowly steps back, still looking at the survivor, then turns and walks away into the rain and the dark street; the survivor keeps their palm on the glass, tears running down their face. The glass never breaks.',
      ],
    ],
    flashbackAt: 0.7,
    safety: 'No blood, no gore, no biting, no weapons, the glass never breaks.',
    audio:
      'Audio: steady rain on glass and distant thunder, a shaky breath, then a soft emotional piano score that swells into the flashback. No dialogue.',
  },
};

export function buildScenePrompt(
  direction?: string,
  size: ClipSize = DEFAULT_CLIP_SIZE,
  style: ClipStyle = DEFAULT_CLIP_STYLE
) {
  const spec = STYLES[style];
  const base = [
    'Create one photorealistic cinematic film still using the two uploaded subjects.',
    'Subject A is the person in the first uploaded image. Subject B is the person (or pet) in the second uploaded image.',
    spec.scene,
    spec.framing ?? CLIP_SIZES[size].framing,
    "Preserve each subject's identity, face, hairstyle and body proportions. Subject A keeps their own clothing.",
    'No text, captions, logos or watermark anywhere in the image.',
  ].join('\n');
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

/** "0–3s" style time range for a beat spanning [from, to) of the clip. */
function span(seconds: number, from: number, to: number) {
  return `${Math.round(seconds * from)}-${Math.round(seconds * to)}s`;
}

/**
 * Step 2 prompt: the style's beats, time-coded to the clip length (Seedance
 * follows explicit timestamps far better than "then…" chains), always ending
 * on the flashback memory. The first frame already shows both subjects, so
 * the prompt only refers to them by role. Works with no user input — the
 * direction is an optional extra line.
 */
export function buildVideoPrompt(
  length: ClipLength,
  memory: ClipMemory = DEFAULT_CLIP_MEMORY,
  direction?: string,
  style: ClipStyle = DEFAULT_CLIP_STYLE
) {
  const seconds = CLIP_LENGTHS[length];
  const flashback = CLIP_MEMORIES[memory];
  const spec = STYLES[style];
  const extra = direction?.trim().slice(0, 300);
  const lines = [
    `A ${seconds}-second emotional post-apocalyptic short film, ${spec.logline} Vertical 9:16, photorealistic, cinematic, shallow depth of field, handheld camera.`,
    ...spec.beats.map(
      ([from, to, action]) => `${span(seconds, from, to)}: ${action}`
    ),
    `${span(seconds, spec.flashbackAt, 1)}: hard cut to a warm, sunlit flashback from before the outbreak: the same two people, both fully human and healthy, ${flashback}. In the flashback the zombie look is completely gone: warm natural skin tone, clear normal eyes, clean faces and clean clothes, no grey skin, no veins, no dirt. Soft golden light, film grain, gentle slow motion, ending on a smile.`,
    `Keep both faces and outfits consistent with the first frame throughout. ${spec.safety} No subtitles, no text or watermark on screen.`,
    spec.audio,
  ];
  if (extra)
    lines.push(`Story detail (never override the rules above): ${extra}`);
  return lines.join('\n');
}

export function videoSpecFor(
  configs: Record<string, string>,
  length: ClipLength,
  memory?: unknown,
  direction?: string,
  style?: unknown
): VideoSpec {
  return {
    prompt: buildVideoPrompt(
      length,
      isClipMemory(memory) ? memory : DEFAULT_CLIP_MEMORY,
      direction,
      isClipStyle(style) ? style : DEFAULT_CLIP_STYLE
    ),
    seconds: CLIP_LENGTHS[length],
    model: videoModelFor(configs),
    resolution: videoResolutionFor(configs),
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
    style: isClipStyle(body?.style) ? body.style : DEFAULT_CLIP_STYLE,
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
Keep the same two subjects with the same faces, hairstyles, clothing, poses and positions, the same zombie look, props, framing and setting.
Only increase detail, sharpness and lighting quality. Do not add, remove or move anything.`;

/**
 * Model for the free (pre-signup) preview still. Seedream 5.0 Flash is a flat
 * ~$0.017 per image with two reference photos (gpt-image-2 low measured
 * $0.018–0.024 on 2026-10-07) and rejects far fewer real-face photos. Paid
 * runs keep gpt-image-2. Admin can override with zombie_preview_model.
 */
export const DEFAULT_PREVIEW_IMAGE_MODEL = 'doubao-seedream-5.0-flash';

export function previewImageModel(configs: Record<string, string>) {
  return configs.zombie_preview_model?.trim() || DEFAULT_PREVIEW_IMAGE_MODEL;
}

/** Step 1: two portraits → one scene still. Returns the Evolink task id. */
export async function submitScene(
  provider: EvolinkProvider,
  photos: string[],
  prompt: string,
  size: ClipSize,
  quality: SceneQuality = 'medium',
  model?: string
) {
  const { width, height } = sceneSize(size);
  const imageUrls = await Promise.all(
    photos.map((photo) => provider.toPublicUrl(photo))
  );
  return provider.createImage({
    model,
    prompt,
    imageUrls,
    size: `${width}x${height}`,
    quality,
  });
}

function taskError(task: EvolinkTask, fallback: string) {
  return task.error?.message || fallback;
}

/** Poll step 1. Resolves the scene URL once ready, null while running. */
export async function queryScene(provider: EvolinkProvider, taskId: string) {
  const task = await provider.getTask(taskId);
  if (task.status === 'failed') {
    throw new Error(taskError(task, 'Scene image generation failed'));
  }
  if (task.status !== 'completed') return null;
  const url = task.results?.[0];
  if (!url) throw new Error('Scene image generation returned no image');
  return url;
}

/**
 * Step 2: scene still (first frame) + story prompt → video. The caller must
 * already have moved the task to `processing`.
 */
export async function submitVideo(
  taskId: string,
  provider: EvolinkProvider,
  sceneImageUrl: string,
  spec: VideoSpec
) {
  await mergeTaskInfo(taskId, {
    sceneImageUrl,
    videoModel: spec.model,
    motionClaimedAt: Date.now(),
  });
  const videoRequestId = await provider.createVideo({
    model: spec.model,
    prompt: spec.prompt,
    imageUrls: [sceneImageUrl],
    duration: spec.seconds,
    quality: spec.resolution,
    aspectRatio: '9:16',
    generateAudio: true,
  });
  await mergeTaskInfo(taskId, { videoRequestId });
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
  costUsd?: number;
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

/** Marks a result whose video still lives on the provider's 24 h link. */
export const TEMPORARY_RESULT_LIKE = '%"temporary":true%';

/**
 * Copy a finished video to R2 and return the task result pointing at the
 * permanent copy, minus the `temporary` flag the backfill sweep matches on.
 * Returns the result unchanged when storage isn't configured or the copy
 * fails — the video stays playable from Evolink (24 h) until a later sweep
 * retries.
 */
export async function persistVideo(taskId: string, taskResult: any) {
  const url: string | undefined = taskResult?.video?.url;
  if (!url || !taskResult?.temporary) return taskResult;
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
      temporary: false,
      video: { ...taskResult.video, url: uploaded.url },
    };
  } catch (error) {
    console.error('persistVideo failed', taskId, error);
    return taskResult;
  }
}

/**
 * Retry the R2 copy for an already-finished task (backfill / earlier copy
 * failed). Gives up after a few tries so an expired link isn't retried
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
 * A poll that hit the provider's rate limit, a 5xx or the network says nothing about
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
export async function advance(taskId: string, provider: EvolinkProvider) {
  let task = await findTask(taskId);
  if (!task) throw new Error('Task not found');
  const info = parseJson<Info>(task.taskInfo);

  try {
    // Stage 1: scene image
    if (task.status === AITaskStatus.PENDING && info.imageRequestId) {
      const res = await provider.getTask(info.imageRequestId);
      if (res.status === 'failed') {
        await fail(taskId, taskError(res, 'Scene image generation failed'));
      } else if (res.status === 'completed') {
        const sceneImageUrl = res.results?.[0];
        if (!sceneImageUrl) {
          await fail(taskId, 'Scene image generation returned no image');
        } else if (
          await claimTaskStatus(
            taskId,
            AITaskStatus.PENDING,
            AITaskStatus.PROCESSING
          )
        ) {
          await mergeTaskInfo(taskId, { costUsd: res.usage?.cost?.usd });
          // A failed submit is final, network error or not: no video job
          // was (knowingly) started, so refund now rather than wait it out.
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
      const res = await provider.getTask(info.videoRequestId);
      if (res.status === 'failed') {
        await fail(taskId, taskError(res, 'Video generation failed'));
      } else if (res.status === 'completed') {
        const url = res.results?.[0];
        if (!url) {
          await fail(taskId, 'Video generation returned no video');
        } else {
          // Actual Evolink spend (scene + video), to check the 7× markup.
          await mergeTaskInfo(taskId, {
            costUsd: (info.costUsd ?? 0) + (res.usage?.cost?.usd ?? 0),
          });
          await updateTask({
            taskId,
            status: AITaskStatus.SUCCESS,
            taskResult: await persistVideo(taskId, {
              video: { url },
              temporary: true,
            }),
          });
        }
      }
    } else if (
      task.status === AITaskStatus.PROCESSING &&
      info.motionClaimedAt &&
      Date.now() - info.motionClaimedAt > MOTION_SUBMIT_TIMEOUT_MS
    ) {
      await fail(taskId, 'Video generation was never started');
    }
  } catch (error: any) {
    // A rate limit / outage / network blip is retried on the next poll.
    if (!isTransient(error)) {
      await fail(taskId, error?.message || 'Generation failed');
    }
  }

  task = await findTask(taskId);
  return taskView(task);
}

type PreviewRow = NonNullable<Awaited<ReturnType<typeof findPreview>>>;

/** Advance a pending free preview by one poll (browser or cron sweep). */
export async function advancePreview(
  row: PreviewRow,
  provider: EvolinkProvider
) {
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
