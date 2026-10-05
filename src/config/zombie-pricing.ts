/**
 * Zombie Trend credit pricing (client-safe, no server imports).
 *
 * 1 credit is sold at no less than $0.01 (see ./pricing.ts), and each video is
 * charged at ≥ 3× its fal cost:
 *   fal cost = GPT Image 2 edit scene (9:16, ~$0.13 measured on the duet
 *              pipeline) + Seedance 2.0 Fast image-to-video at 720p
 *              (~$0.242 / second — fal lists ~$2.42 per 10 s clip).
 * Source: fal.ai model pages (2026-10-06). Standard Seedance 2.0 is
 * ~$0.3034 / s; switching zombie_video_model to it needs a price review.
 */

export const FAL_SCENE_IMAGE_USD = 0.13;
export const FAL_VIDEO_USD_PER_SECOND = 0.242;
export const PRICE_MARKUP = 3;
export const USD_PER_CREDIT = 0.01;

export function falCostUsd(seconds: number) {
  return FAL_SCENE_IMAGE_USD + FAL_VIDEO_USD_PER_SECOND * seconds;
}

export function clipCredits(seconds: number) {
  const s = Math.min(Math.max(seconds, 4), 15);
  const credits = (falCostUsd(s) * PRICE_MARKUP) / USD_PER_CREDIT;
  // Round off float noise, then up to a whole 10 credits so prices read
  // cleanly (906.6 → 910).
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
 * (zombie_credits_8 / _12 / _15) wins; otherwise 3× the fal cost.
 */
export function resolveClipCreditsFor(
  configs: Record<string, string>,
  length: ClipLength
) {
  const override = Number(configs[`zombie_credits_${length}`]);
  if (Number.isFinite(override) && override > 0) return Math.ceil(override);
  return clipCredits(CLIP_LENGTHS[length]);
}

/** Default-length price, for callers that only show one number. */
export function resolveClipCredits(configs: Record<string, string>) {
  return resolveClipCreditsFor(configs, DEFAULT_CLIP_LENGTH);
}
