import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createFooterBadgeAutomationHandler,
  hashBadgeToken,
} from '../src/server/footer-badge-automation';

const token = 'bbg_' + 'a'.repeat(43);
const origin = 'https://product.example.test';
const badge = {
  href: 'https://directory.example.test/',
  text: 'Directory',
  alt: 'Directory',
  attributes: { 'data-proof': 'official' },
};
const request = (body: unknown, credential = token, audience = origin) =>
  new Request(origin + '/api/integrations/footer-badges', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credential}`,
      'X-Backlora-Site': audience,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

test('disabled, wrong and revoked credentials never reach storage', async () => {
  let hash = '';
  let writes = 0;
  const handler = createFooterBadgeAutomationHandler({
    tokenHash: () => hash,
    siteOrigin: () => origin,
    add: async () => {
      writes++;
    },
    limit: () => null,
  });
  assert.equal(
    (await handler({ request: request({ action: 'add', badge }) })).status,
    503
  );
  hash = await hashBadgeToken(token);
  assert.equal(
    (
      await handler({
        request: request({ action: 'add', badge }, 'bbg_' + 'b'.repeat(43)),
      })
    ).status,
    401
  );
  hash = await hashBadgeToken('bbg_' + 'c'.repeat(43));
  assert.equal(
    (await handler({ request: request({ action: 'add', badge }) })).status,
    401
  );
  assert.equal(writes, 0);
});

test('capability check is read-only and the credential has no remove/replace scope', async () => {
  let writes = 0;
  const hash = await hashBadgeToken(token);
  const handler = createFooterBadgeAutomationHandler({
    tokenHash: () => hash,
    siteOrigin: () => origin,
    add: async () => {
      writes++;
    },
    limit: () => null,
  });
  const check = await handler({ request: request({ action: 'check' }) });
  assert.equal((await check.json()).data.scope, 'footer_badges:add');
  for (const action of ['remove', 'replace', 'settings', 'delete'])
    assert.equal(
      (await handler({ request: request({ action, badges: [] }) })).status,
      403
    );
  assert.equal(
    (
      await handler({
        request: request(
          { action: 'add', badge },
          token,
          'https://other.example.test'
        ),
      })
    ).status,
    403
  );
  assert.equal(writes, 0);
});

test('validated metadata survives installation; unsafe/oversized payloads do not write', async () => {
  const saved: any[] = [];
  const hash = await hashBadgeToken(token);
  const handler = createFooterBadgeAutomationHandler({
    tokenHash: () => hash,
    siteOrigin: () => origin,
    add: async (b) => {
      saved.push(b);
    },
    limit: () => null,
  });
  const response = await handler({
    request: request({ action: 'add', badge }),
  });
  assert.equal(response.status, 200);
  assert.equal(saved[0].attributes['data-proof'], 'official');
  assert.ok(!(await response.text()).includes(token));
  assert.equal(
    (
      await handler({
        request: request({
          action: 'add',
          badge: { ...badge, attributes: { onClick: 'alert(1)' } },
        }),
      })
    ).status,
    400
  );
  assert.equal(
    (
      await handler({
        request: request({ action: 'add', badge, padding: 'x'.repeat(25_000) }),
      })
    ).status,
    400
  );
  assert.equal(saved.length, 1);
});

test('storage errors never expose query text, credentials or internal values', async () => {
  const hash = await hashBadgeToken(token);
  const handler = createFooterBadgeAutomationHandler({
    tokenHash: () => hash,
    siteOrigin: () => origin,
    add: async () => {
      throw new Error('private-query:' + token);
    },
    limit: () => null,
  });
  const response = await handler({
    request: request({ action: 'add', badge }),
  });
  assert.equal(response.status, 409);
  assert.ok(!(await response.text()).includes(token));
});
