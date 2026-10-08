'use client';

import { lazy, Suspense, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Film,
  Infinity as InfinityIcon,
  MonitorPlay,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';

import { useSession } from '@/core/auth/client';
import { useRouter } from '@/core/i18n/navigation';
import { pricingCatalog } from '@/config/pricing';
import { clipCredits } from '@/config/zombie-pricing';
import { apiGet, apiPost } from '@/lib/api-client';
import { currentPathWithQuery } from '@/lib/redirect';
import { track } from '@/lib/track';
import { m } from '@/paraglide/messages.js';
import { usePublicConfig } from '@/hooks/use-public-config';
import type { PaymentProvider } from '@/components/payment-provider-modal';
import {
  PricingTable,
  type PricingFeature,
  type PricingGroup,
  type PricingPlan,
} from '@/components/pricing-table';

const PaymentProviderModal = lazy(() =>
  import('@/components/payment-provider-modal').then((mod) => ({
    default: mod.PaymentProviderModal,
  }))
);

// $9.9 rather than $9.90; whole dollars stay $23.
function usd(cents: number) {
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

const ALL_PROVIDERS: PaymentProvider[] = [
  'stripe',
  'creem',
  'waffo',
  'paypal',
  'alipay',
  'wechat',
];

export function Pricing({
  title,
  variant = 'section',
  redirect,
}: {
  title?: string;
  /** `dialog` drops the page-section chrome for use inside a modal. */
  variant?: 'section' | 'dialog';
  /** Where checkout returns to (default: the current page). */
  redirect?: string;
} = {}) {
  const router = useRouter();
  const { data: session } = useSession();

  const { data: configsData, refetch: refetchConfigs } = usePublicConfig();
  const configs = configsData ?? {};
  const [modalOpen, setModalOpen] = useState(false);
  // The provider picker (a dialog) loads on first open and stays mounted.
  const [modalMounted, setModalMounted] = useState(false);
  if (modalOpen && !modalMounted) setModalMounted(true);
  const [pendingPlan, setPendingPlan] = useState<PricingPlan | null>(null);
  const [loadingProvider, setLoadingProvider] =
    useState<PaymentProvider | null>(null);

  const enabledProviders = useMemo<PaymentProvider[]>(
    () => ALL_PROVIDERS.filter((p) => configs[`${p}_enabled`] === 'true'),
    [configs]
  );

  // Live per-video price so "≈ N videos" matches what generation charges.
  const { data: priceData } = useQuery({
    queryKey: ['zombie-price'],
    queryFn: () =>
      apiGet<{ credits: number; lengths?: Record<string, number> }>(
        '/api/zombie/price'
      ),
    staleTime: 10 * 60_000,
  });
  const perLength = {
    8: priceData?.lengths?.['8'] ?? clipCredits(8),
    12: priceData?.lengths?.['12'] ?? clipCredits(12),
    15: priceData?.lengths?.['15'] ?? clipCredits(15),
  };

  // "3 × 8s / 2 × 12s" — only the lengths the pack can actually pay for.
  function videosFit(credits: number) {
    return ([8, 12, 15] as const)
      .map((seconds) => ({
        seconds,
        count: Math.floor(credits / perLength[seconds]),
      }))
      .filter(({ count }) => count > 0)
      .map(({ seconds, count }) =>
        m['landing.pricing.video_count']({ count, seconds })
      )
      .join(m['landing.pricing.or']());
  }

  function features(credits: number, extra: PricingFeature[]) {
    return [
      {
        icon: Sparkles,
        label: m['landing.pricing.feature_credits']({
          credits: credits.toLocaleString('en-US'),
        }),
      },
      {
        icon: Film,
        label: m['landing.pricing.feature_videos_fit']({
          list: videosFit(credits),
        }),
      },
      { icon: MonitorPlay, label: m['landing.pricing.feature_hd']() },
      ...extra,
    ];
  }

  // Display data comes from the same catalog the checkout API trusts.
  function plan(
    productId: string,
    opts: {
      name: string;
      description: string;
      featured?: boolean;
      badge?: string;
      highlight?: string;
      plainFrame?: boolean;
      extra?: PricingFeature[];
      originalPrice?: string;
    }
  ): PricingPlan {
    const product = pricingCatalog[productId];
    const interval = product.plan?.interval;
    // Yearly plans are shown as their monthly equivalent, billed yearly.
    const yearly = interval === 'year';
    const card: PricingPlan = {
      id: productId,
      name: opts.name,
      description: yearly
        ? `${opts.description} · ${m['landing.pricing.billed_yearly']({ price: usd(product.priceInCents) })}`
        : opts.description,
      price: usd(
        yearly ? Math.round(product.priceInCents / 12) : product.priceInCents
      ),
      originalPrice: opts.originalPrice,
      interval: interval ? m['landing.pricing.per_month']() : undefined,
      featured: opts.featured,
      badge: opts.badge,
      plainFrame: opts.plainFrame,
      highlight: opts.highlight,
      features: features(product.credits, opts.extra ?? []),
      productId,
      priceInCents: product.priceInCents,
      currency: product.currency,
      credits: product.credits,
      plan: product.plan,
      buttonText: product.plan ? undefined : m['landing.pricing.buy_now'](),
    };
    return card;
  }

  const packExtra = [
    {
      icon: InfinityIcon,
      label: m['landing.pricing.feature_no_subscription'](),
    },
  ];
  // One-time packs only — a single group, so the table shows no tabs.
  const groups: PricingGroup[] = [
    {
      key: 'one-time',
      label: m['landing.pricing.one_time'](),
      plans: [
        plan('pack_single', {
          name: m['landing.pricing.pack_single'](),
          description: m['landing.pricing.pack_single_desc'](),
          extra: packExtra,
        }),
        plan('pack_starter', {
          name: m['landing.pricing.pack_starter'](),
          description: m['landing.pricing.pack_starter_desc'](),
          featured: true,
          badge: m['landing.pricing.popular'](),
          extra: packExtra,
        }),
        plan('pack_standard', {
          name: m['landing.pricing.pack_standard'](),
          description: m['landing.pricing.pack_desc'](),
          extra: packExtra,
        }),
        plan('pack_pro', {
          name: m['landing.pricing.pack_pro'](),
          description: m['landing.pricing.pack_desc'](),
          extra: packExtra,
        }),
      ],
    },
  ];

  const checkoutMutation = useMutation({
    mutationFn: ({
      plan,
      provider,
    }: {
      plan: PricingPlan;
      provider?: PaymentProvider;
    }) =>
      apiPost<{ checkout_url?: string }>('/api/payment/checkout', {
        product_id: plan.productId,
        product_name: plan.productName || plan.name,
        plan_name: plan.plan?.name || plan.name,
        price: plan.priceInCents,
        currency: plan.currency || 'usd',
        type: plan.plan ? 'subscription' : 'one-time',
        description: plan.name,
        plan: plan.plan,
        credits: plan.credits,
        credits_valid_days: plan.creditsValidDays,
        payment_provider: provider,
        // Come back to the page the user paid from.
        redirect: redirect ?? currentPathWithQuery('/settings/billing'),
      }),
    onSuccess: (data) => {
      if (!data?.checkout_url) {
        toast.error('Checkout failed');
        setLoadingProvider(null);
        return;
      }
      window.location.href = data.checkout_url;
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Checkout failed');
      setLoadingProvider(null);
    },
  });

  function startCheckout(plan: PricingPlan, provider?: PaymentProvider) {
    track('begin_checkout', {
      plan: plan.productId ?? '',
      value: (plan.priceInCents ?? 0) / 100,
    });
    setLoadingProvider(provider ?? null);
    checkoutMutation.mutate({ plan, provider });
  }

  async function handleCheckout(plan: PricingPlan) {
    if (!session?.user) {
      const callbackUrl = encodeURIComponent(currentPathWithQuery('/pricing'));
      router.push(`/sign-in?callbackUrl=${callbackUrl}`);
      return;
    }

    // A click can land before public config has loaded — fetch it first
    // instead of guessing a provider that may not be configured.
    const cfg = configsData ?? (await refetchConfigs()).data ?? {};
    const enabled = ALL_PROVIDERS.filter((p) => cfg[`${p}_enabled`] === 'true');
    const selectEnabled = cfg.select_payment_enabled === 'true';
    // Unknown → omit it; the server falls back to the admin default provider.
    const defaultProvider = (cfg.default_payment_provider || enabled[0]) as
      | PaymentProvider
      | undefined;

    if (selectEnabled && enabled.length > 1) {
      setPendingPlan(plan);
      setModalOpen(true);
      return;
    }

    await startCheckout(plan, defaultProvider);
  }

  function handleProviderSelect(provider: PaymentProvider) {
    if (!pendingPlan) return;
    startCheckout(pendingPlan, provider);
  }

  const dialog = variant === 'dialog';
  const Wrapper = dialog ? 'div' : 'section';

  return (
    <Wrapper
      id={dialog ? undefined : 'pricing'}
      className={
        dialog ? undefined : 'border-border border-t px-4 py-24 sm:py-32'
      }
    >
      <div className="mx-auto max-w-6xl">
        <div className={dialog ? 'mb-8 pr-8 text-center' : 'mb-20 text-center'}>
          <h2
            className={
              dialog
                ? 'font-serif text-3xl font-medium sm:text-4xl'
                : 'font-serif text-5xl font-medium tracking-tight sm:text-6xl'
            }
          >
            {title ?? m['landing.pricing.title']()}
          </h2>
          <p className="text-muted-foreground mt-5">
            {m['landing.pricing.description']()}
          </p>
          <p className="text-muted-foreground mt-2 text-sm">
            {m['landing.pricing.per_video_all']({
              s8: perLength[8].toLocaleString('en-US'),
              s12: perLength[12].toLocaleString('en-US'),
              s15: perLength[15].toLocaleString('en-US'),
            })}
          </p>
          <p className="text-muted-foreground mt-2 inline-flex items-center gap-1.5 text-sm">
            <ShieldCheck className="size-4 shrink-0" aria-hidden />
            {m['landing.pricing.refund_note']()}
          </p>
        </div>
        <PricingTable
          groups={groups}
          defaultGroup="one-time"
          onCheckout={handleCheckout}
        />
      </div>

      {modalMounted && (
        <Suspense fallback={null}>
          <PaymentProviderModal
            open={modalOpen}
            onOpenChange={(open) => {
              setModalOpen(open);
              if (!open) {
                setPendingPlan(null);
                setLoadingProvider(null);
              }
            }}
            providers={enabledProviders.length ? enabledProviders : ['stripe']}
            loadingProvider={loadingProvider}
            onSelect={handleProviderSelect}
            planName={pendingPlan?.name}
            price={pendingPlan?.price}
          />
        </Suspense>
      )}
    </Wrapper>
  );
}
