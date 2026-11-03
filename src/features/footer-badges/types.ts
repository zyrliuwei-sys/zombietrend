export interface FooterBadge {
  href: string;
  src?: string;
  alt: string;
  text?: string;
  rel?: string;
  attributes?: Record<string, string>;
  imageAttributes?: Record<string, string>;
  width?: number;
  height?: number;
}

export const MAX_FOOTER_BADGES = 200;
