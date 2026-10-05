// Cloudflare Builds checks out only tracked files. Recreate the ignored
// Wrangler working copy and public build variables before compiling.
import { readFileSync, writeFileSync } from 'node:fs';

const config = JSON.parse(readFileSync('wrangler.production.json', 'utf8'));
const vars = config.vars;

if (
  config.name !== 'zombietrend' ||
  vars?.DATABASE_PROVIDER !== 'd1' ||
  !/^https:\/\//.test(vars.VITE_APP_URL) ||
  !/^[0-9a-f-]{36}$/.test(config.d1_databases?.[0]?.database_id ?? '')
) {
  throw new Error('Invalid production Worker config');
}

writeFileSync('wrangler.jsonc', `${JSON.stringify(config, null, 2)}\n`);

const buildVars = Object.entries(vars).filter(
  ([key, value]) =>
    (key === 'DATABASE_PROVIDER' || key.startsWith('VITE_')) &&
    typeof value === 'string'
);
writeFileSync(
  '.env.production',
  `${buildVars.map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n')}\n`
);
