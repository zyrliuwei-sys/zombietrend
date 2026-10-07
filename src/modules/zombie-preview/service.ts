/**
 * Zombie Trend free previews: anonymous scene stills, limited per IP/device
 * per day plus a site-wide daily cap that bounds the fal bill.
 */

import { and, asc, count, eq, gte, isNull, ne } from 'drizzle-orm';

import { db } from '@/core/db';
import { zombiePreview, type ZombiePreview } from '@/config/db/schema';
import { getUuid } from '@/lib/hash';

export const PreviewStatus = {
  PENDING: 'pending',
  SUCCESS: 'success',
  FAILED: 'failed',
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

function since() {
  return new Date(Date.now() - DAY_MS);
}

/**
 * Previews this visitor started in the last 24h, counted separately per
 * device and per IP. Failed runs don't count, so a provider error never burns
 * someone's free try.
 */
export async function countVisitorPreviews(ipHash: string, deviceId: string) {
  const recent = (match: ReturnType<typeof eq>) =>
    db()
      .select({ n: count() })
      .from(zombiePreview)
      .where(
        and(
          gte(zombiePreview.createdAt, since()),
          ne(zombiePreview.status, PreviewStatus.FAILED),
          match
        )
      );
  const [[byDevice], [byIp]] = await Promise.all([
    recent(eq(zombiePreview.deviceId, deviceId)),
    recent(eq(zombiePreview.ipHash, ipHash)),
  ]);
  return { device: Number(byDevice?.n ?? 0), ip: Number(byIp?.n ?? 0) };
}

/** Previews started site-wide in the last 24h (failed ones included). */
export async function countAllPreviews() {
  const [row] = await db()
    .select({ n: count() })
    .from(zombiePreview)
    .where(gte(zombiePreview.createdAt, since()));
  return Number(row?.n ?? 0);
}

export async function createPreview(params: {
  ipHash: string;
  deviceId: string;
  userId?: string | null;
  size: string;
  style: string;
  quality: string;
}): Promise<ZombiePreview> {
  const [row] = await db()
    .insert(zombiePreview)
    .values({
      id: getUuid(),
      ipHash: params.ipHash,
      deviceId: params.deviceId,
      userId: params.userId ?? null,
      status: PreviewStatus.PENDING,
      size: params.size,
      style: params.style,
      quality: params.quality,
      createdAt: new Date(),
    })
    .returning();
  return row;
}

export async function findPreview(id: string) {
  const [row] = await db()
    .select()
    .from(zombiePreview)
    .where(eq(zombiePreview.id, id))
    .limit(1);
  return row as ZombiePreview | undefined;
}

export async function updatePreview(
  id: string,
  patch: Partial<
    Pick<ZombiePreview, 'status' | 'requestId' | 'sceneImageUrl' | 'error'>
  >
) {
  await db().update(zombiePreview).set(patch).where(eq(zombiePreview.id, id));
}

/**
 * Link a preview to the paid task that animates it. Returns false when
 * another request already claimed it, so a preview is animated only once.
 */
export async function claimPreview(id: string, userId: string, taskId: string) {
  const rows = await db()
    .update(zombiePreview)
    .set({ userId, taskId })
    .where(and(eq(zombiePreview.id, id), isNull(zombiePreview.taskId)))
    .returning({ id: zombiePreview.id });
  return rows.length > 0;
}

/** Pending previews, oldest first, for the background sweep. */
export async function listPendingPreviews(limit = 20) {
  return db()
    .select()
    .from(zombiePreview)
    .where(eq(zombiePreview.status, PreviewStatus.PENDING))
    .orderBy(asc(zombiePreview.createdAt))
    .limit(limit);
}
