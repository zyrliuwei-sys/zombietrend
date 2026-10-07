/**
 * Frame of the zombie scene (client-safe).
 *
 * The scene still is the first frame of the Seedance video, so its size sets
 * the clip's framing. Only vertical 9:16 is offered — the format TikTok,
 * Reels and Shorts play full screen. `isClipSize` still accepts the key so
 * older previews keep working if more framings are added later.
 */

export const CLIP_SIZES = {
  '9:16': {
    width: 720,
    height: 1280,
    framing:
      'Use a tall vertical 9:16 cinematic composition, both subjects framed from about the waist up, the survivor in the near foreground and the turned one a few steps away facing them.',
  },
} as const;

export type ClipSize = keyof typeof CLIP_SIZES;

export const DEFAULT_CLIP_SIZE: ClipSize = '9:16';

export const OFFERED_CLIP_SIZES: ClipSize[] = ['9:16'];

export function isClipSize(value: unknown): value is ClipSize {
  return typeof value === 'string' && value in CLIP_SIZES;
}

/**
 * The flashback the clip cuts to after the hug — the "happiest day" beat of
 * the trend. Picked in the generator; each maps to one line of the video
 * prompt (see routes/api/zombie/-pipeline.ts).
 */
export const CLIP_MEMORIES = {
  sunny: 'laughing together on a picnic blanket in a sunny green park',
  beach: 'walking barefoot hand in hand on a beach at golden sunset',
  snow: 'laughing and hugging on a bright snowy mountain slope',
  kitchen: 'cooking noodles and laughing together in a cozy warm kitchen',
  wedding: 'dancing together on their wedding day under string lights',
} as const;

export type ClipMemory = keyof typeof CLIP_MEMORIES;

export const DEFAULT_CLIP_MEMORY: ClipMemory = 'sunny';

export function isClipMemory(value: unknown): value is ClipMemory {
  return typeof value === 'string' && value in CLIP_MEMORIES;
}

/**
 * The story the clip tells. Each style has its own scene still and video
 * beats (see routes/api/zombie/-pipeline.ts); all end on the flashback
 * memory. Picked in the generator; the free preview is made for one style,
 * and animating it keeps that style.
 */
export const CLIP_STYLES = ['gun', 'cure', 'glass'] as const;

export type ClipStyle = (typeof CLIP_STYLES)[number];

export const DEFAULT_CLIP_STYLE: ClipStyle = 'gun';

export function isClipStyle(value: unknown): value is ClipStyle {
  return (
    typeof value === 'string' &&
    (CLIP_STYLES as readonly string[]).includes(value)
  );
}
