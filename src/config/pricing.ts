/**
 * Authoritative pricing catalog.
 *
 * The checkout API uses this as the SOURCE OF TRUTH for price/credits/duration.
 * Any price, credits, or plan info sent by the client is IGNORED — only the
 * product_id is honored, and everything else is looked up here.
 *
 * To change pricing, edit this file and redeploy. Admin UI cannot alter prices.
 */

import { PaymentInterval, PaymentType } from '@/core/payment/types';

export type PricingPlanInfo = {
  name: string;
  interval: PaymentInterval;
  intervalCount: number;
};

export type PricingProduct = {
  productId: string;
  productName: string;
  planName: string;
  description: string;
  type: PaymentType;
  priceInCents: number;
  currency: string;
  credits: number;
  creditsValidDays?: number;
  plan?: PricingPlanInfo;
};

/**
 * ZombieTrend catalog. A zombie video costs a fixed number of credits per
 * length (see ./zombie-pricing.ts — 7× the Evolink cost at 720p: 580 for
 * 8 s, 860 for 12 s, 1,070 for 15 s). The four one-time packs are what
 * the pricing page sells; the monthly plans stay in the catalog only so
 * existing subscriptions keep renewing.
 *
 * Pricing floor: no product may sell credits below $0.01 each, so every
 * video is sold at 7× its Evolink cost — check priceInCents / credits ≥ 0.01
 * before adding a product.
 * Keys MUST match what the pricing UI sends as product_id.
 */
export const pricingCatalog: Record<string, PricingProduct> = {
  pack_single: {
    productId: 'pack_single',
    productName: 'Single Video',
    planName: 'Single Video',
    description: 'Single Video',
    type: PaymentType.ONE_TIME,
    // $5.90: one 8 s video (580 credits).
    priceInCents: 590,
    currency: 'usd',
    credits: 590,
  },
  pack_starter: {
    productId: 'pack_starter',
    productName: 'Starter Pack',
    planName: 'Starter Pack',
    description: 'Starter Pack',
    type: PaymentType.ONE_TIME,
    // $10.90: one video of any length (15 s = 1,070 credits).
    priceInCents: 1090,
    currency: 'usd',
    credits: 1090,
  },
  pack_standard: {
    productId: 'pack_standard',
    productName: 'Standard Pack',
    planName: 'Standard Pack',
    description: 'Standard Pack',
    type: PaymentType.ONE_TIME,
    // $19.90: two 12 s videos (1,720) or three 8 s ones (1,740).
    priceInCents: 1990,
    currency: 'usd',
    credits: 1990,
  },
  pack_pro: {
    productId: 'pack_pro',
    productName: 'Pro Pack',
    planName: 'Pro Pack',
    description: 'Pro Pack',
    type: PaymentType.ONE_TIME,
    // $39.90: four 12 s videos (3,440) or six 8 s ones (3,480).
    priceInCents: 3990,
    currency: 'usd',
    credits: 3990,
  },
  basic_monthly: {
    productId: 'basic_monthly',
    productName: 'Basic',
    planName: 'Basic Monthly',
    description: 'Basic Monthly',
    type: PaymentType.SUBSCRIPTION,
    priceInCents: 1990,
    currency: 'usd',
    credits: 1990,
    plan: {
      name: 'Basic',
      interval: PaymentInterval.MONTH,
      intervalCount: 1,
    },
  },
  pro_monthly: {
    productId: 'pro_monthly',
    productName: 'Pro',
    planName: 'Pro Monthly',
    description: 'Pro Monthly',
    type: PaymentType.SUBSCRIPTION,
    priceInCents: 3990,
    currency: 'usd',
    credits: 3990,
    plan: {
      name: 'Pro',
      interval: PaymentInterval.MONTH,
      intervalCount: 1,
    },
  },
  studio_monthly: {
    productId: 'studio_monthly',
    productName: 'Studio',
    planName: 'Studio Monthly',
    description: 'Studio Monthly',
    type: PaymentType.SUBSCRIPTION,
    priceInCents: 7990,
    currency: 'usd',
    credits: 7990,
    plan: {
      name: 'Studio',
      interval: PaymentInterval.MONTH,
      intervalCount: 1,
    },
  },
};

export function getPricingProduct(productId: string): PricingProduct | null {
  if (!productId) return null;
  return pricingCatalog[productId] ?? null;
}

export function listPricingProducts(): PricingProduct[] {
  return Object.values(pricingCatalog);
}
