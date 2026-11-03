import type { FooterBadge } from './types';
import { badgeAttributes, validateFooterBadges } from './validation';

function metadata(element: Element, standard: string[]) {
  const extra: Record<string, string> = {};
  for (const { name, value } of Array.from(element.attributes)) {
    if (name === 'style') {
      // Common official embeds include harmless sizing. Extract only numeric
      // dimensions below; do not persist or execute arbitrary CSS.
      for (const declaration of value
        .split(';')
        .filter((part) => part.trim())) {
        if (
          !/^\s*(?:width|height|max-width|max-height)\s*:\s*(?:[0-9]+(?:px|%)?|auto)\s*$/i.test(
            declaration
          )
        )
          throw new Error('invalid_markup');
      }
    } else if (!standard.includes(name)) extra[name] = value;
  }
  return badgeAttributes(extra);
}

function dimension(element: Element | undefined, name: 'width' | 'height') {
  if (element?.hasAttribute(name)) return Number(element.getAttribute(name));
  const value = (element as HTMLElement | undefined)?.style?.[name];
  return value && /^\d+px$/.test(value)
    ? Number.parseInt(value, 10)
    : undefined;
}

/** Parse safe data, never render pasted HTML. Scripts, handlers, SVG and active CSS are rejected. */
export function parseFooterBadgeMarkup(markup: string): FooterBadge[] {
  if (!markup.trim() || markup.length > 20_000)
    throw new Error('invalid_markup');
  const doc = new DOMParser().parseFromString(markup, 'text/html');
  const anchors = Array.from(doc.body.children);
  if (
    doc.head.children.length ||
    !anchors.length ||
    anchors.some((el) => el.tagName !== 'A') ||
    Array.from(doc.body.childNodes).some(
      (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()
    )
  )
    throw new Error('invalid_markup');

  return validateFooterBadges(
    anchors.map((anchor) => {
      const target = anchor.getAttribute('target');
      if (target && target !== '_blank' && target !== '_self')
        throw new Error('invalid_markup');
      const children = Array.from(anchor.children);
      if (
        children.length > 1 ||
        (children.length === 1 && children[0].tagName !== 'IMG')
      )
        throw new Error('invalid_markup');
      const img = children[0];
      const text = anchor.textContent?.trim() || undefined;
      return {
        href: anchor.getAttribute('href') ?? '',
        src: img?.getAttribute('src') ?? undefined,
        alt:
          img?.getAttribute('alt')?.trim() ||
          text?.slice(0, 120) ||
          anchor.getAttribute('aria-label') ||
          anchor.getAttribute('title') ||
          img?.getAttribute('title') ||
          new URL(anchor.getAttribute('href') || '').hostname,
        text,
        rel: anchor.getAttribute('rel') ?? undefined,
        attributes: metadata(anchor, ['href', 'target', 'rel']),
        imageAttributes: img
          ? metadata(img, ['src', 'alt', 'width', 'height', 'loading'])
          : undefined,
        width: dimension(img, 'width'),
        height: dimension(img, 'height'),
      };
    })
  );
}
