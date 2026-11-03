import type { FooterBadge } from '@/features/footer-badges/types';
import { validateFooterBadges } from '@/features/footer-badges/validation';

import { enforceMinIntervalRateLimit } from '@/lib/rate-limit';
import { respData, respErr } from '@/lib/resp';

export async function hashBadgeToken(token: string) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token)
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
}

function sameHash(a: string, b: string) {
  if (a.length !== 64 || b.length !== 64) return false;
  let difference = 0;
  for (let i = 0; i < 64; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing body');
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 20_000) {
      await reader.cancel();
      throw new Error('Body too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** This credential cannot read settings, delete badges, or authenticate any user API. */
export function createFooterBadgeAutomationHandler(options: {
  tokenHash: () => string;
  siteOrigin: () => string;
  add: (badge: FooterBadge) => Promise<unknown>;
  limit?: typeof enforceMinIntervalRateLimit;
}) {
  const limit = options.limit ?? enforceMinIntervalRateLimit;
  return async ({ request }: { request: Request }): Promise<Response> => {
    const limited = limit(request, {
      intervalMs: 100,
      keyPrefix: 'badge-integration-ip',
    });
    if (limited) return limited;
    const expected = options.tokenHash();
    if (!/^[a-f0-9]{64}$/.test(expected))
      return respErr('badge_api_disabled', { status: 503 });
    const token = request.headers
      .get('authorization')
      ?.match(/^Bearer (bbg_[A-Za-z0-9_-]{43})$/i)?.[1];
    if (!token || !sameHash(await hashBadgeToken(token), expected))
      return respErr('Invalid badge credential', { status: 401 });
    let origin: string;
    try {
      origin = new URL(options.siteOrigin()).origin;
    } catch {
      return respErr('Invalid site configuration', { status: 503 });
    }
    if (request.headers.get('x-backlora-site') !== origin)
      return respErr('Badge credential audience mismatch', { status: 403 });
    const userLimited = limit(request, {
      intervalMs: 250,
      keyPrefix: 'badge-integration',
      extraKey: origin,
    });
    if (userLimited) return userLimited;
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      return respErr('JSON required', { status: 415 });
    let body: any;
    try {
      body = await readBody(request);
    } catch {
      return respErr('Invalid or oversized badge request', { status: 400 });
    }
    const capability = {
      protocol: 'backlora-badges-v1',
      scope: 'footer_badges:add',
      site_origin: origin,
    };
    if (body?.action === 'check')
      return respData(capability, { headers: { 'Cache-Control': 'no-store' } });
    if (body?.action !== 'add')
      return respErr('Only check and add are allowed', { status: 403 });
    let badge: FooterBadge;
    try {
      [badge] = validateFooterBadges([body.badge]);
    } catch {
      return respErr('Unsupported badge data', { status: 400 });
    }
    try {
      await options.add(badge);
      return respData(
        { ...capability, installed: true, href: badge.href },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    } catch {
      // Never return SQL, configuration or request values in an error.
      return respErr('Badge could not be saved; retry the same badge', {
        status: 409,
      });
    }
  };
}
