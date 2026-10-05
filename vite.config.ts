import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import mdx from '@mdx-js/rollup';
import tailwindcss from '@tailwindcss/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { defineConfig } from 'vite';

import { paraglideDirectImports } from './paraglide-direct-imports.mjs';
import { paraglideConfig } from './paraglide.config.mjs';
import { loadEnvFiles } from './src/lib/env';

// Populate process.env from .env.local / .env.{NODE_ENV} / .env for the
// dev server and build process (Vite only exposes VITE_* via import.meta.env;
// server code reads secrets from process.env). In production, env comes
// from the actual host/container environment.
loadEnvFiles();

// Cloudflare Workers build (pnpm cf:build / cf:deploy): stub out unused DB
// drivers — mysql2 crashes workerd at module evaluation (node:net,
// node:process requires); postgres.js runs fine under nodejs_compat but is
// dead weight when the backend is D1. Which driver the bundle keeps follows
// wrangler.jsonc `vars.DATABASE_PROVIDER` (the runtime truth on workerd) —
// d1 stubs both, postgresql keeps postgres.js for the Hyperdrive binding.
const isCloudflareBuild = (process.env.NITRO_PRESET || '').includes(
  'cloudflare'
);
const driverStub = fileURLToPath(
  new URL('./src/core/db/driver-stub.ts', import.meta.url)
);

// Prefer wrangler.jsonc over the build-time env, which can be polluted by
// .env.local (e.g. DATABASE_PROVIDER=sqlite for local dev).
function workersDbProvider(): string {
  try {
    const raw = readFileSync(
      new URL('./wrangler.jsonc', import.meta.url),
      'utf8'
    );
    const m = raw.match(/"DATABASE_PROVIDER"\s*:\s*"([^"]+)"/);
    if (m) return m[1];
  } catch {
    // no wrangler.jsonc yet (fresh clone) — fall through
  }
  return process.env.DATABASE_PROVIDER || 'd1';
}

const workersDb = isCloudflareBuild ? workersDbProvider() : '';
const keepPostgres = workersDb === 'postgresql' || workersDb === 'postgres';

export default defineConfig({
  define: {
    // Versions the homepage HTML edge cache (src/server.ts) per build.
    __BUILD_ID__: JSON.stringify(Date.now().toString(36)),
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
    // Cloud sandboxes (ShipAny Code / e2b) proxy the dev server through a
    // per-sandbox subdomain; without this Vite's host check blocks the
    // preview with "Blocked request. This host is not allowed."
    allowedHosts: ['.e2b.app'],
  },
  // Source maps for browser JS only (Lighthouse "valid source maps"). Client
  // code is public anyway and carries no secrets (only VITE_* vars reach it);
  // the server bundle keeps no public maps.
  environments: {
    client: {
      build: {
        sourcemap: true,
        rolldownOptions: {
          // Compiled Paraglide messages are pure functions: unused ones can
          // be dropped along with the imports that only re-export them.
          treeshake: {
            moduleSideEffects: (id: string) =>
              !/[\\/]paraglide[\\/]messages[\\/]/.test(id),
            // Form schemas (`const schema = z.object(...)`) sit at the top of
            // route files; the route splitter keeps top-level calls in the
            // always-loaded route config. Building a zod schema has no side
            // effects, so let unused ones (and zod) drop from the entry.
            manualPureFunctions: ['z'],
          },
          output: {
            codeSplitting: {
              // Don't drag shared deps (the Paraglide runtime) into groups.
              includeDependenciesRecursively: false,
              groups: [
                // admin.* / settings.* messages (~720 of ~1070) are only
                // used behind sign-in; keep them out of the chunks the
                // public homepage downloads.
                {
                  name: 'messages-app',
                  test: /src[\\/]paraglide[\\/]messages[\\/](admin|settings)_/,
                },
              ],
            },
          },
        },
      },
    },
  },
  resolve: {
    tsconfigPaths: true,
    alias: isCloudflareBuild
      ? {
          mysql2: driverStub,
          ...(keepPostgres ? {} : { postgres: driverStub }),
        }
      : {},
  },
  plugins: [
    // MDX must run before the react plugin so JSX in compiled MDX gets transformed.
    { enforce: 'pre', ...mdx({ providerImportSource: '@mdx-js/react' }) },
    tailwindcss(),
    paraglideVitePlugin(paraglideConfig),
    paraglideDirectImports({
      messagesDir: fileURLToPath(
        new URL('./src/paraglide/messages', import.meta.url)
      ),
    }),
    tanstackStart({
      srcDirectory: 'src',
    }),
    viteReact(),
    // Cloudflare cron → /api/zombie/cron (finishes tasks whose tab closed).
    nitro({ plugins: ['./src/nitro/cron.ts'] }),
  ],
});
