import { createFileRoute, Outlet } from '@tanstack/react-router';

import { m } from '@/paraglide/messages.js';

export const Route = createFileRoute('/(auth)')({
  head: () => ({ meta: [{ name: 'robots', content: 'noindex,nofollow' }] }),
  component: AuthLayout,
});

// Split layout: a letterboxed still from the story on the left (desktop
// only), the form on the right. Same "cold night" frame as the homepage.
function AuthLayout() {
  return (
    <div className="bg-background grid min-h-svh lg:grid-cols-[1.05fr_1fr]">
      <figure className="border-border relative m-0 hidden overflow-hidden border-r lg:block">
        <img
          src="/imgs/generated/zt-hero-mobile.jpg"
          alt=""
          width={576}
          height={944}
          className="absolute inset-0 size-full object-cover saturate-[0.8]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        <figcaption className="absolute inset-x-0 bottom-16 px-10 text-center font-serif text-2xl text-[#f6eccf] italic [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">
          {m['zombie.hero.sub_cold']()}
        </figcaption>
      </figure>
      <div className="[&>div]:bg-background [&>div]:min-h-svh">
        <Outlet />
      </div>
    </div>
  );
}
