/**
 * Zombie Trend credit pricing (client-safe, no server imports).
 *
 * 1 credit is sold at $0.01 (see ./pricing.ts), and each video is charged
 * at 7× its Evolink cost, as actually billed on real runs (2026-10-06):
 *   GPT Image 2 scene still (720×1280, medium, two reference photos) $0.040
 *   Seedance 2.0 Fast image-to-video: 720p $0.394 / 4 s = $0.0985/s,
 *                                     480p $0.366 / 8 s = $0.0458/s
 * That is about half the evolink.ai list price (720p "$0.199/s"), which
 * includes a Fast-model promo said to end 2026-10-06. If Evolink raises the
 * rate, raise these — each task logs its real spend as `costUsd` in
 * taskInfo. The standard (non-Fast) model costs more; review before
 * switching zombie_video_model to it.
 */

export const SCENE_IMAGE_USD = 0.04;
export const VIDEO_USD_PER_SECOND = { '720p': 0.0985, '480p': 0.0458 } as const;
export type VideoResolution = keyof typeof VIDEO_USD_PER_SECOND;
export const PRICE_MARKUP = 7;
export const USD_PER_CREDIT = 0.01;

export function videoResolutionFor(
  configs: Record<string, string>
): VideoResolution {
  return configs.zombie_video_resolution === '480p' ? '480p' : '720p';
}

export function evolinkCostUsd(
  seconds: number,
  resolution: VideoResolution = '720p'
) {
  return SCENE_IMAGE_USD + VIDEO_USD_PER_SECOND[resolution] * seconds;
}

export function clipCredits(
  seconds: number,
  resolution: VideoResolution = '720p'
) {
  const s = Math.min(Math.max(seconds, 4), 15);
  const credits =
    (evolinkCostUsd(s, resolution) * PRICE_MARKUP) / USD_PER_CREDIT;
  // Round off float noise, then up to a whole 10 credits so prices read
  // cleanly (855.4 → 860).
  return Math.ceil(Number(credits.toFixed(6)) / 10) * 10;
}

/**
 * Clip lengths offered in the generator. 12 s fits all four beats of the
 * trend (aim → recognise → hug → flashback); 8 s is a tighter cut and 15 s
 * gives the memory more room.
 */
export const CLIP_LENGTHS = { '8': 8, '12': 12, '15': 15 } as const;
export type ClipLength = keyof typeof CLIP_LENGTHS;
export const DEFAULT_CLIP_LENGTH: ClipLength = '12';

export function isClipLength(value: unknown): value is ClipLength {
  return typeof value === 'string' && value in CLIP_LENGTHS;
}

/**
 * Credits for one video of the given length. An admin override
 * (zombie_credits_8 / _12 / _15) wins; otherwise 7× the Evolink cost.
 */
export function resolveClipCreditsFor(
  configs: Record<string, string>,
  length: ClipLength
) {
  const override = Number(configs[`zombie_credits_${length}`]);
  if (Number.isFinite(override) && override > 0) return Math.ceil(override);
  return clipCredits(CLIP_LENGTHS[length], videoResolutionFor(configs));
}

/** Default-length price, for callers that only show one number. */
export function resolveClipCredits(configs: Record<string, string>) {
  return resolveClipCreditsFor(configs, DEFAULT_CLIP_LENGTH);
}
