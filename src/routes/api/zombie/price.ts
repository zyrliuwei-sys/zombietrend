import { createFileRoute } from '@tanstack/react-router';

import {
  CLIP_LENGTHS,
  resolveClipCredits,
  resolveClipCreditsFor,
  type ClipLength,
} from '@/config/zombie-pricing';
import { getAllConfigs } from '@/modules/config/service';
import { respData, respErr } from '@/lib/resp';

// Public: credits one clip video costs, per length (generator + pricing).
async function GET() {
  try {
    const configs = await getAllConfigs();
    const lengths = Object.fromEntries(
      (Object.keys(CLIP_LENGTHS) as ClipLength[]).map((l) => [
        l,
        resolveClipCreditsFor(configs, l),
      ])
    ) as Record<ClipLength, number>;
    // `credits` (8 s) kept for callers that only know one price.
    return respData({ credits: resolveClipCredits(configs), lengths });
  } catch (error: any) {
    return respErr(error?.message || 'Internal error');
  }
}

export const Route = createFileRoute('/api/zombie/price')({
  server: { handlers: { GET } },
});
