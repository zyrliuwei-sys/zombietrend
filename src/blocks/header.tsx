import { m } from '@/paraglide/messages.js';
import { SiteHeader } from '@/components/site-header';

export function Header() {
  const navLinks = [
    { href: '/#create', label: m['zombie.nav.create']() },
    { href: '/#how', label: m['zombie.nav.how']() },
    { href: '/#ideas', label: m['zombie.nav.ideas']() },
    { href: '/pricing', label: m['zombie.nav.pricing']() },
    { href: '/#faq', label: m['zombie.nav.faq']() },
  ];

  return <SiteHeader navLinks={navLinks} logoAlt={m['zombie.logo_alt']()} />;
}
