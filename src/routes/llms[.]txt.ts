import { createFileRoute } from '@tanstack/react-router';

import { envConfigs } from '@/config';
import { m } from '@/paraglide/messages.js';

const STATIC_PAGES: { path: string; title: string; description: string }[] = [
  {
    path: '',
    title: 'AI Zombie Trend Video Generator',
    description:
      'Make the AI zombie love story / zombie hug video from two photos, with the copyable four-beat prompt',
  },
  {
    path: '/privacy-policy',
    title: 'Privacy Policy',
    description: 'Privacy information',
  },
  {
    path: '/terms-of-service',
    title: 'Terms of Service',
    description: 'Terms of use',
  },
  {
    path: '/acceptable-use-policy',
    title: 'Acceptable Use Policy',
    description: 'Content rules, child safety and how to report violations',
  },
];

export const Route = createFileRoute('/llms.txt')({
  server: {
    handlers: {
      GET: async () => {
        const { app_url, app_name } = envConfigs;

        let posts: { slug: string; title: string; description: string }[] = [];
        try {
          const { listPublishedArticles } =
            await import('@/modules/posts/service');
          const rows = await listPublishedArticles().catch(() => []);
          posts = rows.map((row) => ({
            slug: row.slug,
            title: row.title || row.slug,
            description: row.description || '',
          }));
        } catch {
          // Database unreachable — static project pages still listed.
        }

        const lines: string[] = [
          `# ${app_name}`,
          '',
          `> ${m['common.metadata.description']({}, { locale: 'en' })}`,
          '',
          '## Pages',
          '',
          ...STATIC_PAGES.map(
            (p) => `- [${p.title}](${app_url}${p.path}): ${p.description}`
          ),
        ];

        if (posts.length > 0) {
          lines.push('', '## Blog Posts', '');
          for (const post of posts) {
            lines.push(
              `- [${post.title}](${app_url}/blog/${post.slug}): ${post.description}`
            );
          }
        }

        lines.push('');

        return new Response(lines.join('\n'), {
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      },
    },
  },
});
