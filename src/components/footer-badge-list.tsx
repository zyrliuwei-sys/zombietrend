import type { CSSProperties } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import { DEFAULT_FOOTER_BADGES } from '@/features/footer-badges/defaults';
import type { FooterBadge } from '@/features/footer-badges/types';
import { parseStoredFooterBadges } from '@/features/footer-badges/validation';

import { cn } from '@/lib/utils';
import { usePublicConfig } from '@/hooks/use-public-config';

/** Each marquee half repeats the list until it holds at least this many badges, so short lists still span wide screens. */
const MIN_BADGES_PER_LOOP = 12;
const SECONDS_PER_BADGE = 3;

function BadgeRow({
  badges,
  hidden,
}: {
  badges: FooterBadge[];
  hidden?: boolean;
}) {
  return (
    <ul
      className="flex shrink-0 items-center"
      aria-hidden={hidden || undefined}
    >
      {badges.map((badge, index) => (
        <li
          key={`${index}:${badge.href}:${badge.src}`}
          className="shrink-0 pr-4"
        >
          <a
            href={badge.href}
            target="_blank"
            rel="noopener noreferrer"
            tabIndex={hidden ? -1 : undefined}
            className="flex h-12 items-center transition-opacity hover:opacity-80"
          >
            <img
              src={badge.src}
              alt={hidden ? '' : badge.alt}
              width={badge.width ?? 250}
              height={badge.height}
              loading="lazy"
              draggable={false}
              className="h-full w-auto max-w-[260px] object-contain"
            />
          </a>
        </li>
      ))}
    </ul>
  );
}

const rootRoute = getRouteApi('__root__');

export function FooterBadgeList({ className }: { className?: string }) {
  const { data } = usePublicConfig();
  // Server-rendered list from the root loader until the live config arrives.
  const ssrStored = rootRoute.useLoaderData({
    select: (d) => d.footerBadges,
  });
  const stored = data ? data.footer_badges : (ssrStored ?? undefined);
  const badges =
    stored === undefined
      ? DEFAULT_FOOTER_BADGES
      : parseStoredFooterBadges(stored);

  if (badges.length === 0) return null;

  const repeat = Math.ceil(MIN_BADGES_PER_LOOP / badges.length);
  const loop = Array.from({ length: repeat }, () => badges).flat();
  const style = {
    '--badge-marquee-duration': `${loop.length * SECONDS_PER_BADGE}s`,
  } as CSSProperties;

  return (
    <div className={cn('badge-marquee w-full overflow-hidden', className)}>
      <div className="badge-marquee-track flex w-max" style={style}>
        <BadgeRow badges={loop} />
        <BadgeRow badges={loop} hidden />
      </div>
    </div>
  );
}
