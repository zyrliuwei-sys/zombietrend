/**
 * Homepage hero images (client-safe, no React).
 *
 * Kept out of blocks/zombie-trend.tsx so routes/index.tsx can preload the
 * hero without pulling the whole page block into the entry chunk.
 */

export const HERO_DESKTOP_IMAGE = '/imgs/generated/zt-hero.jpg';
export const HERO_MOBILE_IMAGE = '/imgs/generated/zt-hero-mobile.jpg';
export const HERO_MOBILE_MEDIA = '(max-width: 600px)';
export const OG_IMAGE = '/imgs/generated/zt-hero.jpg';
