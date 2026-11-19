'use client';

import { useEffect, useRef, useState } from 'react';

import { getAuthClient, useSession } from '@/core/auth/client';
import { usePublicConfig } from '@/hooks/use-public-config';

// Mounts the Google One Tap prompt for signed-out visitors when the
// admin has enabled it. Self-contained: pulls config from
// /api/config/public, gates on session, and triggers at most once
// per page load.
//
// Waits for the visitor's first interaction: prompting on load makes Chrome
// log "Not signed in with the identity provider" (FedCM) for every visitor
// without a Google session, which Lighthouse counts as a console error.
export function GoogleOneTap() {
  const { data: session, isPending } = useSession();
  const { data: configs } = usePublicConfig();
  const triggered = useRef(false);
  const [interacted, setInteracted] = useState(false);

  useEffect(() => {
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
    const onInteract = () => {
      setInteracted(true);
      events.forEach((e) => window.removeEventListener(e, onInteract));
    };
    events.forEach((e) =>
      window.addEventListener(e, onInteract, { passive: true, once: true })
    );
    return () =>
      events.forEach((e) => window.removeEventListener(e, onInteract));
  }, []);

  useEffect(() => {
    if (!interacted) return;
    if (triggered.current) return;
    if (!configs) return;
    if (isPending) return;
    if (session?.user) return;
    if (
      configs.google_one_tap_enabled !== 'true' ||
      !configs.google_client_id
    ) {
      return;
    }

    triggered.current = true;
    const client = getAuthClient(configs);
    (client as any)
      .oneTap?.({
        // Stay put: One Tap fires on whatever page the visitor is reading.
        callbackURL: window.location.href,
        onPromptNotification: () => {
          // Silently ignore dismissals / FedCM hiccups — the user can still
          // sign in via the normal /sign-in page.
        },
      })
      .catch(() => {
        // Same — One Tap cancellations throw NetworkError/AbortError that
        // aren't actionable.
      });
  }, [interacted, configs, session, isPending]);

  return null;
}
