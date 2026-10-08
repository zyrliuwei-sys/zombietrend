/**
 * Shared helpers for the free-preview routes: visitor identity (IP hash +
 * device cookie) and the admin-tunable limits.
 */

import { PreviewStatus } from '@/modules/zombie-preview/service';
import { getUuid, md5 } from '@/lib/hash';

export const DEVICE_COOKIE = 'zt_did';
export const FREE_PREVIEW_USED = 'FREE_PREVIEW_USED';
export const FREE_PREVIEW_PAUSED = 'FREE_PREVIEW_PAUSED';

// ~$0.02 each on Evolink (low-quality still from two photos), so the cap
// bounds free spend at ~$2/day. The free still is the main conversion step —
// no free videos are given away — so raise it if visitors start hitting it.
const DEFAULT_DAILY_CAP = 100;
const DEFAULT_PER_VISITOR = 1;

function readNumber(value: string | undefined, fallback: number) {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/**
 * Free previews are off unless switched on in admin settings; then 0 for
 * either limit also switches them off. Off → visitors pay before generating.
 */
export function previewLimits(configs: Record<string, string>) {
  if (configs.zombie_free_preview_enabled !== 'true') {
    return { dailyCap: 0, perVisitor: 0 };
  }
  return {
    dailyCap: readNumber(configs.zombie_free_preview_cap, DEFAULT_DAILY_CAP),
    perVisitor: readNumber(
      configs.zombie_free_preview_per_visitor,
      DEFAULT_PER_VISITOR
    ),
  };
}

// cf-connecting-ip is set by Cloudflare and can't be forged by the client,
// unlike the first x-forwarded-for entry; prefer it.
function clientIp(request: Request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    ''
  );
}

export function visitor(request: Request) {
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(
    new RegExp(`(?:^|;\\s*)${DEVICE_COOKIE}=([\\w-]{8,64})`)
  );
  const existing = match?.[1];
  return {
    ipHash: md5(`zombie:${clientIp(request)}`),
    deviceId: existing || getUuid(),
    isNewDevice: !existing,
  };
}

/** Set-Cookie header that pins the device id for a year. */
export function deviceCookie(deviceId: string, request: Request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${DEVICE_COOKIE}=${deviceId}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}`;
}

// A finished still is held back until this long after the request, so the
// free preview feels like real work rather than an instant throwaway.
const MIN_PREVIEW_MS = 90_000;

export function isHeld(row: { status: string; createdAt: unknown }) {
  const created = new Date(row.createdAt as any).getTime();
  return (
    row.status === PreviewStatus.SUCCESS &&
    Number.isFinite(created) &&
    Date.now() - created < MIN_PREVIEW_MS
  );
}
