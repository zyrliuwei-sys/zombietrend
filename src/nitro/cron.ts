import { definePlugin } from 'nitro';

// Workers cron trigger (wrangler.jsonc `triggers.crons`) → the app's
// /api/zombie/cron sweep. Routed through nitroApp.fetch so the sweep
// runs inside the normal app (db, configs) instead of a separate bundle.
export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook('cloudflare:scheduled', async ({ env }) => {
    const vars = env as Record<string, string | undefined>;
    const secret = vars.AUTH_SECRET;
    if (!secret) return;
    const origin = vars.VITE_APP_URL || 'https://localhost';
    const res = await nitroApp.fetch(
      new Request(`${origin}/api/zombie/cron`, {
        method: 'POST',
        headers: { 'x-cron-key': secret },
      })
    );
    console.log('cron sweep', res.status, await res.text());
  });
});
