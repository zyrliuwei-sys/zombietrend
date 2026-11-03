import type { FooterBadge } from '@/features/footer-badges/types';
import { badgeRel } from '@/features/footer-badges/validation';

export function FooterBadgeLink({
  badge,
  className,
  imageClassName,
  hidden,
}: {
  badge: FooterBadge;
  className?: string;
  imageClassName?: string;
  hidden?: boolean;
}) {
  return (
    <a
      {...badge.attributes}
      href={badge.href}
      target="_blank"
      rel={badgeRel(badge.rel)}
      tabIndex={hidden ? -1 : undefined}
      aria-hidden={hidden || undefined}
      className={className}
    >
      {badge.src && (
        <img
          {...badge.imageAttributes}
          src={badge.src}
          alt={hidden ? '' : badge.alt}
          width={badge.width ?? 250}
          height={badge.height}
          loading="lazy"
          draggable={false}
          className={imageClassName}
        />
      )}
      {badge.text}
    </a>
  );
}
