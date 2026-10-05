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
 * length (see ./zombie-pricing.ts — 920 for the default 12 s clip, ≈ 3× its
 * ~$3.03 fal cost), and every pack covers a whole number of 12 s videos.
 *
 * Pricing floor: no product may sell credits below $0.01 each, so every
 * video is sold at ≥ 3× its fal cost. That is why there are no discounted
 * yearly plans — check priceInCents / credits ≥ 0.01 before adding a product.
 * Keys MUST match what the pricing UI sends as product_id.
 */
export const pricingCatalog: Record<string, PricingProduct> = {
  pack_single: {
    productId: 'pack_single',
    productName: 'Single Video',
    planName: 'Single Video',
    description: 'Single Video',
    type: PaymentType.ONE_TIME,
    // $9.90 for one 12 s video (920 credits) — the trend's default length.
    priceInCents: 990,
    currency: 'usd',
    credits: 990,
  },
  pack_starter: {
    productId: 'pack_starter',
    productName: 'Starter Pack',
    planName: 'Starter Pack',
    description: 'Starter Pack',
    type: PaymentType.ONE_TIME,
    // $19.90 for two 12 s videos (or three 8 s ones).
    priceInCents: 1990,
    currency: 'usd',
    credits: 1990,
  },
  pack_standard: {
    productId: 'pack_standard',
    productName: 'Standard Pack',
    planName: 'Standard Pack',
    description: 'Standard Pack',
    type: PaymentType.ONE_TIME,
    priceInCents: 3990,
    currency: 'usd',
    credits: 3990,
  },
  pack_pro: {
    productId: 'pack_pro',
    productName: 'Pro Pack',
    planName: 'Pro Pack',
    description: 'Pro Pack',
    type: PaymentType.ONE_TIME,
    priceInCents: 7990,
    currency: 'usd',
    credits: 7990,
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
