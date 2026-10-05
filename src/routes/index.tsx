import { createFileRoute } from '@tanstack/react-router';

import { envConfigs } from '@/config';
import {
  HERO_DESKTOP_IMAGE,
  HERO_MOBILE_IMAGE,
  HERO_MOBILE_MEDIA,
  OG_IMAGE,
} from '@/config/zombie-images';
import { m } from '@/paraglide/messages.js';
import { getLocale, locales, localizeUrl } from '@/paraglide/runtime.js';
import { ZombieTrendPage } from '@/blocks/zombie-trend';

export const Route = createFileRoute('/')({
  loader: () => ({ locale: getLocale() }),
  head: ({ loaderData }) => {
    const locale = loaderData?.locale ?? 'en';
    const title = m['common.metadata.title']({}, { locale: locale as any });
    const description = m['common.metadata.description'](
      {},
      { locale: locale as any }
    );
    const urlFor = (loc: string) =>
      localizeUrl(`${envConfigs.app_url}/`, { locale: loc as any }).href;
    return {
      meta: [
        { title },
        { name: 'description', content: description },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
        { property: 'og:type', content: 'website' },
        {
          property: 'og:image',
          content: `${envConfigs.app_url}${OG_IMAGE}`,
        },
        { name: 'twitter:card', content: 'summary_large_image' },
      ],
      links: [
        // LCP: the hero <picture> sits behind a <source>, which the browser
        // only discovers after layout — preload the matching image.
        {
          rel: 'preload',
          as: 'image',
          media: HERO_MOBILE_MEDIA,
          href: HERO_MOBILE_IMAGE,
          fetchPriority: 'high',
        },
        {
          rel: 'preload',
          as: 'image',
          media: '(min-width: 601px)',
          href: HERO_DESKTOP_IMAGE,
          fetchPriority: 'high',
        },
        { rel: 'canonical', href: urlFor(locale) },
        ...locales.map((loc) => ({
          rel: 'alternate',
          hrefLang: loc,
          href: urlFor(loc),
        })),
        { rel: 'alternate', hrefLang: 'x-default', href: urlFor('en') },
      ],
      scripts: [
        {
          type: 'application/ld+json',
          children: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'WebPage',
            name: title,
            description,
            url: urlFor(locale),
            inLanguage: locale,
            primaryImageOfPage: `${envConfigs.app_url}${OG_IMAGE}`,
          }),
        },
      ],
    };
  },
  component: ZombieTrendPage,
});
