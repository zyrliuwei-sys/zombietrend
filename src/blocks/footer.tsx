import { m } from '@/paraglide/messages.js';
import { FooterBadgeList } from '@/components/footer-badge-list';
import { SiteFooter, type FooterColumn } from '@/components/site-footer';

export function Footer() {
  const columns: FooterColumn[] = [
    {
      title: m['landing.footer.feature'](),
      links: [
        { label: m['zombie.nav.create'](), href: '/#create' },
        { label: m['zombie.nav.how'](), href: '/#how' },
      ],
    },
    {
      title: m['landing.footer.resources'](),
      links: [
        {
          label: 'support@zombietrend.org',
          href: 'mailto:support@zombietrend.org',
        },
      ],
    },
    {
      title: m['landing.footer.legal'](),
      links: [
        { label: m['landing.footer.privacy'](), href: '/privacy-policy' },
        { label: m['landing.footer.terms'](), href: '/terms-of-service' },
        { label: m['landing.footer.aup'](), href: '/acceptable-use-policy' },
      ],
    },
  ];

  return (
    <SiteFooter
      tagline={m['zombie.footer.line']()}
      columns={columns}
      badges={<FooterBadgeList className="mt-10" />}
    />
  );
}
