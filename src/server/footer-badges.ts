import { DEFAULT_FOOTER_BADGES } from '@/features/footer-badges/defaults';
import type { FooterBadge } from '@/features/footer-badges/types';
import {
  parseStoredFooterBadges,
  validateFooterBadges,
} from '@/features/footer-badges/validation';

import {
  compareAndSwapFooterBadges,
  getFooterBadgeSnapshot,
} from '@/modules/footer-badges/service';

export class FooterBadgeConflict extends Error {}

export type FooterBadgeChange =
  | { action: 'add'; badges: FooterBadge[] }
  | { action: 'remove'; badge: FooterBadge }
  | { action: 'replace'; badges: FooterBadge[]; expectedBadges: FooterBadge[] };

function sameBadge(a: FooterBadge, b: FooterBadge) {
  const canonical = (badge: FooterBadge) =>
    JSON.stringify(badge, (_key, value) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
          )
        : value
    );
  return canonical(a) === canonical(b);
}

/** Merge against the latest list and compare-and-swap in a single D1 write.
 * No interactive transaction, lost additions, or duplicate retry inserts.
 */
export async function changeStoredFooterBadges(
  change: FooterBadgeChange
): Promise<FooterBadge[]> {
  const incoming = validateFooterBadges(
    change.action === 'remove' ? [change.badge] : change.badges
  );
  const expected =
    change.action === 'replace'
      ? validateFooterBadges(change.expectedBadges)
      : undefined;
  for (let attempt = 0; attempt < 8; attempt++) {
    const row = await getFooterBadgeSnapshot();
    const current =
      row?.value == null
        ? validateFooterBadges(DEFAULT_FOOTER_BADGES)
        : parseStoredFooterBadges(row.value);
    let next: FooterBadge[];
    if (change.action === 'add') {
      next = [...current];
      for (const badge of incoming) {
        // Re-pasting an official snippet refreshes stripped verification data.
        const index = next.findIndex((b) => b.href === badge.href);
        if (index < 0) next.push(badge);
        else next[index] = badge;
      }
    } else if (change.action === 'remove') {
      const badge = incoming[0];
      const matching = current.filter((b) => b.href === badge.href);
      if (matching.some((b) => !sameBadge(b, badge)))
        throw new FooterBadgeConflict(
          'This badge changed. Refresh the list before removing it.'
        );
      next = current.filter((b) => !sameBadge(b, badge));
    } else {
      if (
        current.length !== expected!.length ||
        current.some((b, i) => !sameBadge(b, expected![i]))
      )
        throw new FooterBadgeConflict(
          'The badge list changed. Refresh before saving.'
        );
      next = incoming;
    }
    next = validateFooterBadges(next);
    const value = JSON.stringify(next);
    if (row?.value === value) return next;
    if (await compareAndSwapFooterBadges(row, value)) return next;
  }
  throw new FooterBadgeConflict('The badge list is busy. Please retry.');
}
