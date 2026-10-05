import { lazy, Suspense, type ComponentType } from 'react';
import { notFound, useLoaderData } from '@tanstack/react-router';

import { envConfigs } from '@/config';
import { m } from '@/paraglide/messages.js';
import {
  baseLocale,
  getLocale,
  locales,
  localizeUrl,
} from '@/paraglide/runtime.js';

type PageMeta = {
  title: string;
  description: string;
  updated_at: string;
};

// Page metadata is bundled eagerly (loader/head need it synchronously); the
// MDX bodies are split into their own chunks and loaded on demand, so the
// legal text isn't part of every page's entry JS. Keys are absolute from the
// project root.
const metas = import.meta.glob<PageMeta>('/src/content/pages/*.mdx', {
  eager: true,
  import: 'meta',
});
const bodies = import.meta.glob<ComponentType>('/src/content/pages/*.mdx', {
  import: 'default',
});

function pageKey(slug: string, locale: string): string | null {
  const own = `/src/content/pages/${slug}.${locale}.mdx`;
  if (metas[own]) return own;
  const base = `/src/content/pages/${slug}.${baseLocale}.mdx`;
  return metas[base] ? base : null;
}

const lazyBodies = new Map<string, ComponentType>();
function pageBody(key: string): ComponentType {
  let Body = lazyBodies.get(key);
  if (!Body) {
    Body = lazy(async () => ({ default: await bodies[key]() }));
    lazyBodies.set(key, Body);
  }
  return Body;
}

type LoaderData = { meta: PageMeta; slug: string; locale: string };

// Shared route options for static MDX pages. Each page gets its own
// explicit route file (e.g. privacy-policy.tsx) so static segments
// always outrank dynamic ones — add a new page by creating the MDX
// content plus a thin route file using this factory.
export function staticPageRouteOptions(slug: string) {
  return {
    loader: (): LoaderData => {
      const locale = getLocale();
      const key = pageKey(slug, locale);
      if (!key) throw notFound();
      return { meta: metas[key], slug, locale };
    },
    head: ({ loaderData }: { loaderData?: LoaderData }) => {
      if (!loaderData) return {};
      const { meta, locale } = loaderData;
      const canonical = localizeUrl(`${envConfigs.app_url}/${slug}`, {
        locale: locale as ReturnType<typeof getLocale>,
      }).href;
      return {
        meta: [
          { title: meta.title },
          { name: 'description', content: meta.description },
        ],
        links: [
          { rel: 'canonical', href: canonical },
          ...locales.map((loc) => ({
            rel: 'alternate',
            hrefLang: loc,
            href: localizeUrl(`${envConfigs.app_url}/${slug}`, { locale: loc })
              .href,
          })),
        ],
      };
    },
    component: StaticPage,
  };
}

function StaticPage() {
  const { meta, slug, locale } = useLoaderData({
    strict: false,
  }) as LoaderData;

  const Content = pageBody(pageKey(slug, locale)!);

  return (
    <article>
      {/* Letterboxed title band, the same frame language as the homepage. */}
      <header className="border-border bg-card border-y">
        <div className="mx-auto max-w-3xl px-6 py-14 md:px-8 md:py-20">
          <h1 className="text-foreground font-serif text-5xl leading-[1.02] font-medium tracking-tight md:text-6xl">
            {meta.title.split(' | ')[0]}
          </h1>
          <p className="text-muted-foreground mt-4 max-w-xl text-base">
            {meta.description}
          </p>
          <p className="text-primary mt-4 text-xs font-semibold tracking-[0.14em] uppercase">
            {m['common.pages.last_updated']()}: {meta.updated_at}
          </p>
        </div>
      </header>
      <div className="text-foreground/90 mx-auto max-w-3xl px-6 py-12 text-[16px] leading-7 md:px-8 md:py-16">
        <Suspense fallback={null}>
          <Content />
        </Suspense>
      </div>
    </article>
  );
}
