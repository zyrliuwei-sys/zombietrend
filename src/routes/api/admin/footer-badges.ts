import { createFileRoute } from '@tanstack/react-router';
import { DEFAULT_FOOTER_BADGES } from '@/features/footer-badges/defaults';
import { parseStoredFooterBadges } from '@/features/footer-badges/validation';
import {
  changeStoredFooterBadges,
  FooterBadgeConflict,
} from '@/server/footer-badges';

import { getAuth } from '@/core/auth';
import { getStoredFooterBadges } from '@/modules/footer-badges/service';
import { hasPermission } from '@/modules/rbac/service';
import { enforceMinIntervalRateLimit } from '@/lib/rate-limit';
import { respData, respErr } from '@/lib/resp';

const noStore = {
  headers: {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  },
};

async function checkSuperAdmin(request: Request) {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return respErr('Unauthorized', { status: 401 });

  // `*` is the built-in permission granted by the super_admin role. Footer
  // badges are a global public-site setting, so regular admins must not edit it.
  const allowed = await hasPermission(session.user.id, '*');
  if (!allowed) return respErr('Forbidden', { status: 403 });

  return { userId: session.user.id };
}

async function GET({ request }: { request: Request }) {
  try {
    const denied = await checkSuperAdmin(request);
    if (denied instanceof Response) return denied;
    const stored = await getStoredFooterBadges();
    return respData(
      stored === undefined
        ? DEFAULT_FOOTER_BADGES
        : parseStoredFooterBadges(stored),
      noStore
    );
  } catch (error) {
    return respErr(error instanceof Error ? error.message : 'Internal error');
  }
}

async function POST({ request }: { request: Request }) {
  try {
    const ipLimited = enforceMinIntervalRateLimit(request, {
      intervalMs: 100,
      keyPrefix: 'footer-badges-ip',
    });
    if (ipLimited) return ipLimited;
    const denied = await checkSuperAdmin(request);
    if (denied instanceof Response) return denied;
    const userLimited = enforceMinIntervalRateLimit(request, {
      intervalMs: 250,
      keyPrefix: 'footer-badges-user',
      extraKey: denied.userId,
    });
    if (userLimited) return userLimited;
    const body = await request.json();
    if (
      !body ||
      typeof body !== 'object' ||
      !['add', 'remove', 'replace'].includes(body.action)
    )
      return respErr('Refresh the page before editing badges.', {
        status: 400,
      });
    const badges = await changeStoredFooterBadges(body);
    return respData(badges, noStore);
  } catch (error) {
    return respErr(error instanceof Error ? error.message : 'Internal error', {
      status: error instanceof FooterBadgeConflict ? 409 : 400,
    });
  }
}

export const Route = createFileRoute('/api/admin/footer-badges')({
  server: { handlers: { GET, POST } },
});
