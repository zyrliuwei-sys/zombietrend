import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/core/db';
import { config } from '@/config/db/schema';

const CONFIG_KEY = 'footer_badges';
export type FooterBadgeSnapshot = { value: string | null } | undefined;

export async function getFooterBadgeSnapshot(): Promise<FooterBadgeSnapshot> {
  const [row] = await db()
    .select({ value: config.value })
    .from(config)
    .where(eq(config.name, CONFIG_KEY))
    .limit(1);
  return row;
}

/** Bypass the per-instance config cache so crawlers see the latest badges. */
export async function getStoredFooterBadges(): Promise<string | undefined> {
  return (await getFooterBadgeSnapshot())?.value ?? undefined;
}

/** One conditional write: safe on D1 without interactive transactions. */
export async function compareAndSwapFooterBadges(
  previous: FooterBadgeSnapshot,
  value: string
): Promise<boolean> {
  const saved = previous
    ? await db()
        .update(config)
        .set({ value })
        .where(
          and(
            eq(config.name, CONFIG_KEY),
            previous.value === null
              ? isNull(config.value)
              : eq(config.value, previous.value)
          )
        )
        .returning({ name: config.name })
    : await db()
        .insert(config)
        .values({ name: CONFIG_KEY, value })
        .onConflictDoNothing()
        .returning({ name: config.name });
  return saved.length > 0;
}
