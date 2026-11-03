import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, test } from 'node:test';
import { sql } from 'drizzle-orm';

const directory = await mkdtemp(join(tmpdir(), 'footer-badges-storage-'));
Object.assign(process.env, {
  DATABASE_PROVIDER: 'sqlite',
  DATABASE_URL: `file:${directory}/test.db`,
  NODE_ENV: 'test',
  AUTH_SECRET: 'isolated-test-only',
});
let dispose: (() => Promise<void>) | undefined;
if (process.env.BADGES_D1 === '1') {
  const configPath = join(directory, 'wrangler.json');
  await writeFile(
    configPath,
    JSON.stringify({
      name: 'badge-tests',
      compatibility_date: '2026-10-01',
      d1_databases: [
        {
          binding: 'DB',
          database_name: 'test',
          database_id: '00000000-0000-0000-0000-000000000001',
        },
      ],
    })
  );
  const { getPlatformProxy } = await import('wrangler');
  const proxy = await getPlatformProxy({ configPath, persist: false });
  (globalThis as any).__CF_ENV__ = proxy.env;
  process.env.DATABASE_PROVIDER = 'd1';
  dispose = proxy.dispose;
}
const { db } = await import('../src/core/db');
const { changeStoredFooterBadges, FooterBadgeConflict } =
  await import('../src/server/footer-badges');
const { getStoredFooterBadges } =
  await import('../src/modules/footer-badges/service');
const { DEFAULT_FOOTER_BADGES } =
  await import('../src/features/footer-badges/defaults');
await db().run(
  sql`create table config (name text primary key not null, value text)`
);
beforeEach(async () => {
  await db().run(sql`delete from config`);
});
after(async () => {
  await dispose?.();
  await rm(directory, { recursive: true, force: true });
});

const badge = (name: string) => ({
  href: `https://${name}.example.test/`,
  alt: name,
  text: name,
  attributes: { 'data-launchai-badge': 'verified' },
});
const stored = async () => JSON.parse((await getStoredFooterBadges())!);

test('simultaneous first additions preserve defaults and every distinct badge', async () => {
  await Promise.all(
    ['one', 'two', 'three', 'four'].map((name) =>
      changeStoredFooterBadges({ action: 'add', badges: [badge(name)] })
    )
  );
  const saved = await stored();
  assert.equal(saved.length, DEFAULT_FOOTER_BADGES.length + 4);
  for (const name of ['one', 'two', 'three', 'four'])
    assert.ok(saved.some((b: any) => b.href === badge(name).href));
});

test('repeat adds are idempotent and repasting restores verification metadata', async () => {
  const plain = { ...badge('one'), attributes: undefined };
  await changeStoredFooterBadges({ action: 'add', badges: [plain] });
  await Promise.all(
    Array.from({ length: 4 }, () =>
      changeStoredFooterBadges({ action: 'add', badges: [badge('one')] })
    )
  );
  const matching = (await stored()).filter(
    (b: any) => b.href === badge('one').href
  );
  assert.equal(matching.length, 1);
  assert.equal(matching[0].attributes['data-launchai-badge'], 'verified');
});

test('concurrent removal and addition do not restore a removed badge or lose a new badge', async () => {
  await changeStoredFooterBadges({ action: 'add', badges: [badge('one')] });
  await Promise.all([
    changeStoredFooterBadges({ action: 'remove', badge: badge('one') }),
    changeStoredFooterBadges({ action: 'add', badges: [badge('two')] }),
  ]);
  assert.ok(!(await stored()).some((b: any) => b.href === badge('one').href));
  assert.ok((await stored()).some((b: any) => b.href === badge('two').href));
});

test('stale replacement and removal cannot erase a newer badge', async () => {
  const before = await changeStoredFooterBadges({
    action: 'add',
    badges: [badge('one')],
  });
  await changeStoredFooterBadges({
    action: 'add',
    badges: [{ ...badge('one'), text: 'Updated' }],
  });
  await assert.rejects(
    changeStoredFooterBadges({
      action: 'replace',
      badges: [],
      expectedBadges: before,
    }),
    FooterBadgeConflict
  );
  await assert.rejects(
    changeStoredFooterBadges({ action: 'remove', badge: badge('one') }),
    FooterBadgeConflict
  );
  assert.equal(
    (await stored()).find((b: any) => b.href === badge('one').href).text,
    'Updated'
  );
});

test('invalid or overflowing additions leave stored data unchanged', async () => {
  const initial = await changeStoredFooterBadges({
    action: 'add',
    badges: [badge('one')],
  });
  await assert.rejects(
    changeStoredFooterBadges({
      action: 'add',
      badges: [{ ...badge('evil'), attributes: { onClick: 'alert(1)' } }],
    })
  );
  await assert.rejects(
    changeStoredFooterBadges({
      action: 'add',
      badges: Array.from({ length: 200 }, (_, i) => badge(`new-${i}`)),
    })
  );
  assert.deepEqual(await stored(), JSON.parse(JSON.stringify(initial)));
});

test('NULL legacy config can be updated without an insert conflict', async () => {
  await db().run(
    sql`insert into config (name, value) values ('footer_badges', null)`
  );
  await changeStoredFooterBadges({ action: 'add', badges: [badge('one')] });
  assert.ok((await stored()).some((b: any) => b.href === badge('one').href));
});
