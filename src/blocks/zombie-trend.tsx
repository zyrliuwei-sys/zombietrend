import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Check,
  Copy,
  Download,
  Loader2,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { useSession } from '@/core/auth/client';
import { Link } from '@/core/i18n/navigation';
import { envConfigs } from '@/config';
import { pricingCatalog } from '@/config/pricing';
import {
  HERO_DESKTOP_IMAGE,
  HERO_MOBILE_IMAGE,
  HERO_MOBILE_MEDIA,
} from '@/config/zombie-images';
import {
  CLIP_LENGTHS,
  DEFAULT_CLIP_LENGTH,
  type ClipLength,
} from '@/config/zombie-pricing';
import {
  CLIP_MEMORIES,
  DEFAULT_CLIP_MEMORY,
  DEFAULT_CLIP_SIZE,
  DEFAULT_CLIP_STYLE,
  isClipStyle,
  OFFERED_CLIP_SIZES,
  type ClipMemory,
  type ClipSize,
  type ClipStyle,
} from '@/config/zombie-sizes';
import { apiGet, apiPost } from '@/lib/api-client';
import { draftDelete, draftGet, draftSet } from '@/lib/draft-store';
import { track } from '@/lib/track';
import { m } from '@/paraglide/messages.js';
import { localizeHref } from '@/paraglide/runtime.js';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import { Pricing } from '@/blocks/pricing';
import { FooterBadgeList } from '@/components/footer-badge-list';

import '@/styles/zombie-trend.css';

// Popups load on demand: the user menu only exists for signed-in visitors and
// the paywall only after running out of credits — keep their dialog/menu code
// out of the homepage's initial JS.
const SiteUserMenu = lazy(() =>
  import('@/components/site-user-menu').then((mod) => ({
    default: mod.SiteUserMenu,
  }))
);
const PaywallDialog = lazy(() => import('@/blocks/paywall-dialog'));

const previewImage = '/imgs/generated/zt-scene.jpg';
// Sample scene per story style (same two AI-generated characters), shown in
// the preview pane until the visitor's own preview arrives.
const styleImages: Record<ClipStyle, string> = {
  gun: previewImage,
  cure: '/imgs/generated/zt-scene-cure.jpg',
  glass: '/imgs/generated/zt-scene-glass.jpg',
};
const coupleImage = '/imgs/generated/zt-couple.jpg';
const dogImage = '/imgs/generated/zt-dog.jpg';
const catImage = '/imgs/generated/zt-cat.jpg';
// The four beats are cut from one Seedance story clip (same two people).
const beatImages = {
  aim: '/imgs/generated/zt-beat-aim.jpg',
  recognise: '/imgs/generated/zt-beat-recognise.jpg',
  hug: '/imgs/generated/zt-beat-hug.jpg',
  remember: '/imgs/generated/zt-beat-remember.jpg',
};

// Short muted loops (Seedance text-to-video; each still is a frame of its
// loop). The still stays in the markup as poster/LCP/SEO image; the loop is
// fetched only near the viewport and fades in over it once playing.
const STILL_VIDEOS: Record<string, string> = {
  [HERO_DESKTOP_IMAGE]: '/videos/zt-hero.mp4',
  [HERO_MOBILE_IMAGE]: '/videos/zt-hero-mobile.mp4',
  [previewImage]: '/videos/zt-hero-mobile.mp4',
  [coupleImage]: '/videos/zt-couple.mp4',
  [dogImage]: '/videos/zt-dog.mp4',
  [catImage]: '/videos/zt-cat.mp4',
  [beatImages.aim]: '/videos/zt-beat-aim.mp4',
  [beatImages.recognise]: '/videos/zt-beat-recognise.mp4',
  [beatImages.hug]: '/videos/zt-beat-hug.mp4',
  [beatImages.remember]: '/videos/zt-beat-remember.mp4',
};

function MotionStill({
  video,
  mobileVideo,
  children,
}: {
  video: string;
  mobileVideo?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const src =
      mobileVideo && window.matchMedia(HERO_MOBILE_MEDIA).matches
        ? mobileVideo
        : video;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (!el.getAttribute('src')) el.src = src;
          el.play().catch(() => {});
        } else {
          el.pause();
        }
      },
      { rootMargin: '200px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [video, mobileVideo]);

  return (
    <span className="zt-motion">
      {children}
      <video
        ref={ref}
        muted
        loop
        playsInline
        preload="none"
        aria-hidden="true"
        tabIndex={-1}
        data-playing={playing ? '' : undefined}
        onPlaying={() => setPlaying(true)}
      />
    </span>
  );
}

/** Plain lazy image (the page's stills are small, pre-compressed JPEGs). */
function OptImage({
  eager,
  ...img
}: {
  src: string;
  eager?: boolean;
  alt: string;
  width: number;
  height: number;
}) {
  const still = (
    <img loading={eager ? undefined : 'lazy'} decoding="async" {...img} />
  );
  const video = STILL_VIDEOS[img.src];
  return video ? <MotionStill video={video}>{still}</MotionStill> : still;
}

// Unedited generator output shown under the hero, so visitors see the paid
// product before buying (no free videos are given away). AI-generated
// people; files in public/videos/examples/. The section hides when empty.
const exampleVideos = [
  {
    key: 'couple',
    src: '/videos/examples/couple.mp4',
    poster: '/videos/examples/couple.jpg',
    label: () => m['zombie.samples.couple'](),
  },
  {
    key: 'mother',
    src: '/videos/examples/mother.mp4',
    poster: '/videos/examples/mother.jpg',
    label: () => m['zombie.samples.mother'](),
  },
  {
    key: 'dog',
    src: '/videos/examples/dog.mp4',
    poster: '/videos/examples/dog.jpg',
    label: () => m['zombie.samples.dog'](),
  },
];

const INSUFFICIENT_CREDITS = 'Insufficient credits';

type ClipTask = {
  id: string;
  status: 'pending' | 'processing' | 'success' | 'failed';
  stage: 'scene' | 'motion' | null;
  sceneImageUrl: string | null;
  videoUrl: string | null;
  error: string | null;
};

type ClipPreview = {
  id: string;
  status: 'pending' | 'success' | 'failed';
  size: string;
  imageUrl: string | null;
  animatedTaskId: string | null;
  error: string | null;
};

type FreeQuota = { left: number; reason: string | null };

const FREE_PREVIEW_USED = 'FREE_PREVIEW_USED';
const FREE_PREVIEW_PAUSED = 'FREE_PREVIEW_PAUSED';
const DIRECTION_BLOCKED = 'DIRECTION_BLOCKED';

type Saved = { previewId?: string; taskId?: string; at: number };
const SAVED_KEY = 'zt-clip';
const SAVED_TTL = 3 * 24 * 60 * 60 * 1000;
const PREVIEW_TTL = 23 * 60 * 60 * 1000;

// Unsent form (photos + options) kept in IndexedDB so it survives the
// sign-in redirect (Google OAuth leaves the site) and reloads. Device-local,
// never uploaded; dropped after a day.
type Draft = {
  photoA: File | null;
  photoB: File | null;
  direction: string;
  style?: ClipStyle;
  memory: ClipMemory;
  size: ClipSize;
  length: ClipLength;
  consent: boolean;
  at: number;
};
const DRAFT_KEY = 'zt-create-draft';
const DRAFT_TTL = 24 * 60 * 60 * 1000;

function loadSaved(): Saved | null {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_KEY) || 'null');
    if (!saved || Date.now() - saved.at >= SAVED_TTL) return null;
    // A preview's still expires with Evolink's 24 h link; only a started
    // task is worth restoring after that.
    if (!saved.taskId && Date.now() - saved.at >= PREVIEW_TTL) return null;
    return saved;
  } catch {
    return null;
  }
}

// Preview the visitor asked to animate before being sent to sign up.
const RESUME_KEY = 'zt-resume-animate';

// `checkout` marks a trip to the payment page, so coming back still short of
// credits (payment cancelled) shows the plans instead of checkout again.
function resumeAnimate(previewId?: string, checkout = false) {
  try {
    if (previewId) {
      localStorage.setItem(
        RESUME_KEY,
        JSON.stringify({ previewId, at: Date.now(), checkout })
      );
    }
  } catch {}
}

/** The pending resume (if fresh), cleared so it only resumes once. */
function takeResumeAnimate():
  | { previewId: string; checkout: boolean }
  | undefined {
  try {
    const raw = localStorage.getItem(RESUME_KEY);
    if (!raw) return undefined;
    localStorage.removeItem(RESUME_KEY);
    const { previewId, at, checkout } = JSON.parse(raw);
    return Date.now() - at < 60 * 60 * 1000
      ? { previewId, checkout: !!checkout }
      : undefined;
  } catch {
    return undefined;
  }
}

/** Cheapest one-time pack that covers a video of `credits`. */
function packFor(credits: number) {
  return Object.values(pricingCatalog)
    .filter((p) => !p.plan && p.credits >= credits)
    .sort((a, b) => a.priceInCents - b.priceInCents)[0];
}

// Cheapest pack price, for "from $X" copy.
const fromPrice = usd(
  Math.min(
    ...Object.values(pricingCatalog)
      .filter((p) => !p.plan)
      .map((p) => p.priceInCents)
  )
);

// $5.90 → "$5.90", $10 → "$10".
function usd(cents: number) {
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: cents % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

function saveState(saved: Saved | null) {
  try {
    if (saved) localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
    else localStorage.removeItem(SAVED_KEY);
  } catch {
    // Private mode / blocked storage: the flow still works, just not resumable.
  }
}

// Free stills arrive with the watermark already burned in on the server
// (api/zombie/preview-image); the canvas just keeps "save image" off.
function WatermarkedImage({
  src,
  alt,
  onError,
}: {
  src: string;
  alt: string;
  onError: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const canvas = ref.current;
      if (!canvas) return;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
    };
    img.onerror = onError;
    // Fetched as a blob (not <img src>) so the request is a plain API call;
    // dev servers treat image-destination requests as static assets.
    let objectUrl: string | undefined;
    let cancelled = false;
    fetch(src)
      .then((res) => (res.ok ? res.blob() : Promise.reject(res.status)))
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        img.src = objectUrl;
      })
      .catch(() => !cancelled && onError());
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);
  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={alt}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}

// Downscale to ≤1536px JPEG so uploads stay small; the server re-uploads them to Evolink.
async function toDataUrl(file: File, maxSide = 1536): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.9);
}

function PhotoInput({
  label,
  side,
  file,
  onFile,
}: {
  label: string;
  side: string;
  file: File | null;
  onFile: (file: File | null) => void;
}) {
  // Derived from the file prop so a draft restored after sign-in shows too.
  const [preview, setPreview] = useState<string>();
  useEffect(() => {
    if (!file) return setPreview(undefined);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <label className="zt-upload">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null;
          if (file && file.size > 10 * 1024 * 1024) {
            alert(m['zombie.upload_limit']());
            e.target.value = '';
            return;
          }
          onFile(file);
        }}
      />
      {preview ? (
        <>
          <img src={preview} alt={label} className="zt-upload-preview" />
          <button
            type="button"
            className="zt-upload-remove"
            aria-label={m['zombie.create.remove_photo']()}
            onClick={(e) => {
              // Inside the label: don't let the click reopen the file picker.
              e.preventDefault();
              e.stopPropagation();
              if (inputRef.current) inputRef.current.value = '';
              onFile(null);
            }}
          >
            <X size={16} strokeWidth={2} />
          </button>
        </>
      ) : (
        <Upload size={24} strokeWidth={1.5} />
      )}
      <span>{label}</span>
      <small>{side}</small>
    </label>
  );
}

export function ZombieTrendPage() {
  const [photoA, setPhotoA] = useState<File | null>(null);
  const [photoB, setPhotoB] = useState<File | null>(null);
  const [direction, setDirection] = useState('');
  const [style, setStyle] = useState<ClipStyle>(DEFAULT_CLIP_STYLE);
  const [memory, setMemory] = useState<ClipMemory>(DEFAULT_CLIP_MEMORY);
  const [size, setSize] = useState<ClipSize>(DEFAULT_CLIP_SIZE);
  const [length, setLength] = useState<ClipLength>(DEFAULT_CLIP_LENGTH);
  const [previewId, setPreviewId] = useState<string>();
  const [taskId, setTaskId] = useState<string>();
  const [consent, setConsent] = useState(false);
  const [menu, setMenu] = useState(false);
  const { data: session } = useSession();
  const user = session?.user;
  const canGenerate = consent && !!photoA && !!photoB;
  const queryClient = useQueryClient();
  const [paywall, setPaywall] = useState(false);
  // Mount the (lazy) paywall dialog on first open and keep it mounted, so
  // its close animation and later opens behave as before.
  const [paywallMounted, setPaywallMounted] = useState(false);
  if (paywall && !paywallMounted) setPaywallMounted(true);

  // Survive the sign-in / checkout round trip and reloads mid-generation:
  // the preview and task ids live in localStorage, photos aren't needed again.
  useEffect(() => {
    const saved = loadSaved();
    if (!saved) return;
    setPreviewId(saved.previewId);
    setTaskId(saved.taskId);
    if (Date.now() - saved.at < 2 * 60 * 60 * 1000) {
      setTimeout(
        () =>
          document
            .getElementById('create')
            ?.scrollIntoView({ behavior: 'smooth' }),
        300
      );
    }
  }, []);
  // Arriving at /#create (e.g. straight after sign-in / sign-up): the browser's
  // own anchor jump fires before images settle the layout, so scroll again.
  useEffect(() => {
    if (window.location.hash !== '#create') return;
    const timer = setTimeout(
      () =>
        document
          .getElementById('create')
          ?.scrollIntoView({ behavior: 'smooth' }),
      300
    );
    return () => clearTimeout(timer);
  }, []);
  // Restore the unsent form, then keep it saved. `draftReady` stops the save
  // effect from overwriting the draft with the empty initial state.
  const [draftReady, setDraftReady] = useState(false);
  useEffect(() => {
    draftGet<Draft>(DRAFT_KEY).then((d) => {
      if (d && Date.now() - d.at < DRAFT_TTL) {
        setPhotoA(d.photoA);
        setPhotoB(d.photoB);
        setDirection(d.direction);
        if (isClipStyle(d.style)) setStyle(d.style);
        if (d.memory in CLIP_MEMORIES) setMemory(d.memory);
        if (OFFERED_CLIP_SIZES.includes(d.size)) setSize(d.size);
        if (d.length in CLIP_LENGTHS) setLength(d.length);
        setConsent(d.consent);
      }
      setDraftReady(true);
    });
  }, []);
  useEffect(() => {
    if (!draftReady) return;
    if (!photoA && !photoB && !direction.trim()) {
      draftDelete(DRAFT_KEY);
      return;
    }
    draftSet(DRAFT_KEY, {
      photoA,
      photoB,
      direction,
      style,
      memory,
      size,
      length,
      consent,
      at: Date.now(),
    } satisfies Draft);
  }, [
    draftReady,
    photoA,
    photoB,
    direction,
    style,
    memory,
    size,
    length,
    consent,
  ]);
  // Only ever written here; cleared explicitly by `forget` so a (re)mount
  // with empty state can't wipe what the restore above is about to read.
  useEffect(() => {
    if (previewId || taskId) saveState({ previewId, taskId, at: Date.now() });
  }, [previewId, taskId]);
  const forget = () => {
    saveState(null);
    setTaskId(undefined);
    setPreviewId(undefined);
  };

  const quotaQuery = useQuery({
    queryKey: ['zombie-free'],
    queryFn: () => apiGet<FreeQuota>('/api/zombie/preview'),
  });
  const freeLeft = quotaQuery.data?.left ?? 0;

  const makePreview = useMutation({
    mutationFn: async () =>
      apiPost<ClipPreview>('/api/zombie/preview', {
        photoA: await toDataUrl(photoA!),
        photoB: await toDataUrl(photoB!),
        direction: direction.trim() || undefined,
        size,
        style,
      }),
    onMutate: () => track('zt_preview_start', { size, style }),
    onSuccess: (preview) => {
      setTaskId(undefined);
      setPreviewId(preview.id);
      queryClient.invalidateQueries({ queryKey: ['zombie-free'] });
    },
    onError: (e: Error) => {
      if (
        e.message === FREE_PREVIEW_USED ||
        e.message === FREE_PREVIEW_PAUSED
      ) {
        track('zt_preview_limit', { reason: e.message });
        queryClient.invalidateQueries({ queryKey: ['zombie-free'] });
      }
    },
  });

  const previewQuery = useQuery({
    queryKey: ['zombie-preview', previewId],
    queryFn: () => apiGet<ClipPreview>(`/api/zombie/preview?id=${previewId}`),
    enabled: !!previewId,
    refetchInterval: (query) =>
      query.state.data?.status === 'pending' ? 4000 : false,
  });
  const preview = previewQuery.data;
  useEffect(() => {
    if (preview?.status === 'success') track('zt_preview_ready');
    // A preview animated in another tab/session: follow its task.
    if (preview?.animatedTaskId && !taskId) setTaskId(preview.animatedTaskId);
  }, [preview?.status, preview?.animatedTaskId]);
  // Saved id that no longer exists (or expired), or a not-yet-animated preview
  // in a framing no longer offered (old 1:1 / 3:4 / 16:9): forget it quietly.
  useEffect(() => {
    if (
      previewQuery.error ||
      (preview &&
        !preview.animatedTaskId &&
        !OFFERED_CLIP_SIZES.includes(preview.size as ClipSize))
    ) {
      forget();
    }
  }, [previewQuery.error, preview?.size, preview?.animatedTaskId]);

  const onTaskStarted = (task: ClipTask) => {
    setTaskId(task.id);
    track('zt_video_start');
    queryClient.invalidateQueries({ queryKey: ['credits'] });
  };
  const onPaidError = (e: Error) => {
    if (e.message === INSUFFICIENT_CREDITS) openPaywall();
  };

  const animate = useMutation({
    mutationFn: () =>
      apiPost<ClipTask>('/api/zombie/animate', {
        previewId,
        length,
        memory,
        direction: direction.trim() || undefined,
      }),
    onSuccess: onTaskStarted,
    onError: onPaidError,
  });

  const generate = useMutation({
    mutationFn: async () =>
      apiPost<ClipTask>('/api/zombie/generate', {
        photoA: await toDataUrl(photoA!),
        photoB: await toDataUrl(photoB!),
        direction: direction.trim() || undefined,
        size,
        style,
        length,
        memory,
      }),
    onSuccess: (task) => {
      setPreviewId(undefined);
      onTaskStarted(task);
    },
    // Server is the source of truth: out of credits → show the paywall.
    onError: onPaidError,
  });

  const taskQuery = useQuery({
    queryKey: ['zombie-task', taskId],
    queryFn: () => apiGet<ClipTask>(`/api/zombie/task?id=${taskId}`),
    enabled: !!taskId && !!user,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'success' || status === 'failed' ? false : 5000;
    },
  });
  const task = taskQuery.data;
  useEffect(() => {
    if (task?.status === 'success') track('zt_video_ready');
  }, [task?.status]);
  const priceQuery = useQuery({
    queryKey: ['zombie-price'],
    queryFn: () =>
      apiGet<{ credits: number; lengths?: Record<ClipLength, number> }>(
        '/api/zombie/price'
      ),
    staleTime: 10 * 60_000,
  });
  const creditsQuery = useQuery({
    queryKey: ['credits'],
    queryFn: () => apiGet<{ balance: number }>('/api/credits'),
    enabled: !!user,
  });
  const { data: permissions } = useUserPermissions(!!user);
  // Price of the selected length (older API responses only had `credits`).
  const price =
    priceQuery.data?.lengths?.[length] ??
    (length === DEFAULT_CLIP_LENGTH ? priceQuery.data?.credits : undefined);
  const openPaywall = () => {
    track('zt_paywall_open');
    setPaywall(true);
  };
  // Pre-check so an unpaid user sees the plans before anything is submitted.
  const lacksCredits = () => {
    const balance = creditsQuery.data?.balance;
    return (
      !permissions?.isAdmin &&
      balance !== undefined &&
      price !== undefined &&
      balance < price
    );
  };
  // Balance covers a shorter clip but not the selected one (e.g. back from
  // buying the 8 s Single Video pack with the 12 s default still selected):
  // switch to the longest clip they can afford instead of showing the plans
  // again right after they paid.
  const balance = creditsQuery.data?.balance;
  const lengthPrices = priceQuery.data?.lengths;
  useEffect(() => {
    if (!draftReady || permissions?.isAdmin) return;
    if (balance === undefined || !lengthPrices) return;
    const selected = lengthPrices[length];
    if (selected === undefined || balance >= selected) return;
    const affordable = (Object.keys(CLIP_LENGTHS) as ClipLength[]).filter(
      (key) => lengthPrices[key] !== undefined && lengthPrices[key] <= balance
    );
    if (affordable.length) setLength(affordable[affordable.length - 1]);
  }, [draftReady, balance, lengthPrices, permissions?.isAdmin]);
  const startGenerate = () => {
    if (lacksCredits()) {
      if (!pack) return openPaywall();
      track('begin_checkout', {
        plan: pack.productId,
        value: pack.priceInCents / 100,
      });
      buyPack.mutate();
      return;
    }
    generate.mutate();
  };
  // The pack a visitor without enough credits buys to make this video.
  const pack = price !== undefined ? packFor(price) : undefined;
  // Straight to checkout for that pack; back on /#create the resume effect
  // below starts the video as soon as the credits are in.
  const buyPack = useMutation({
    mutationFn: () =>
      apiPost<{ checkout_url?: string }>('/api/payment/checkout', {
        product_id: pack!.productId,
        redirect: `${window.location.pathname}#create`,
      }),
    onSuccess: (data) => {
      if (!data?.checkout_url) return openPaywall();
      window.location.href = data.checkout_url;
    },
    onError: () => openPaywall(),
  });
  const startAnimate = () => {
    track('zt_animate_click', { signed_in: user ? 1 : 0 });
    if (!user) {
      track('zt_sign_in_prompt');
      resumeAnimate(previewId);
      window.location.href = localizeHref(
        `/sign-up?callbackUrl=${encodeURIComponent('/#create')}`
      );
      return;
    }
    if (lacksCredits()) {
      if (!pack) return openPaywall();
      track('begin_checkout', {
        plan: pack.productId,
        value: pack.priceInCents / 100,
      });
      resumeAnimate(previewId, true);
      buyPack.mutate();
      return;
    }
    animate.mutate();
  };

  const previewReady = preview?.status === 'success' && !taskId;
  // Show the price in dollars to anyone who would have to pay for this video
  // (signed out, or not enough credits); credits for everyone else.
  const needsToPay =
    !permissions?.isAdmin &&
    (!user ||
      (creditsQuery.data !== undefined &&
        price !== undefined &&
        creditsQuery.data.balance < price));
  const packPrice = needsToPay && pack ? usd(pack.priceInCents) : undefined;
  const busyAnimate = animate.isPending || buyPack.isPending;
  // Back from sign-up or checkout with the preview they wanted animated:
  // carry on without making them find and click the button again. Back from
  // checkout still short of credits (cancelled) → the plans, not checkout.
  useEffect(() => {
    if (
      !user ||
      !previewReady ||
      price === undefined ||
      creditsQuery.data === undefined
    ) {
      return;
    }
    const resume = takeResumeAnimate();
    if (!resume || resume.previewId !== previewId) return;
    if (resume.checkout && lacksCredits()) return openPaywall();
    startAnimate();
  }, [user, previewReady, price, creditsQuery.data, previewId]);
  const previewRunning =
    makePreview.isPending || (!!previewId && preview?.status === 'pending');
  const taskRunning =
    generate.isPending ||
    animate.isPending ||
    (!!taskId && task?.status !== 'success' && task?.status !== 'failed');
  const running = previewRunning || taskRunning;
  // Why the free preview isn't offered: from a rejected attempt, or — for a
  // signed-out visitor — straight from the quota, so the page says "today's
  // free preview is used" instead of silently showing only "Sign in".
  const freeReason =
    makePreview.error?.message ??
    (!user && !previewId && !taskId && quotaQuery.data?.left === 0
      ? quotaQuery.data.reason
      : null);
  const freeError =
    freeReason === FREE_PREVIEW_USED
      ? m['zombie.create.free_used']({ price: fromPrice })
      : freeReason === FREE_PREVIEW_PAUSED
        ? m['zombie.create.free_paused']({ price: fromPrice })
        : null;
  const paidError = (e: Error | null) =>
    e?.message === INSUFFICIENT_CREDITS ? null : e?.message;
  const blockedNote =
    [generate.error, makePreview.error].some(
      (e) => e?.message === DIRECTION_BLOCKED
    ) && m['zombie.create.direction_blocked']();
  const error =
    (blockedNote || null) ??
    paidError(generate.error) ??
    paidError(animate.error) ??
    (freeError ? null : makePreview.error?.message) ??
    // Provider errors mean nothing to the visitor; say what it cost them.
    (preview?.status === 'failed' && !taskId
      ? m['zombie.create.preview_failed']()
      : null) ??
    (task?.status === 'failed' ? m['zombie.create.video_failed']() : null) ??
    null;
  // The inline status line is easy to miss below the button; also toast.
  useEffect(() => {
    if (error) toast.error(`${m['zombie.create.failed']()}: ${error}`);
  }, [error]);
  const reset = () => {
    generate.reset();
    animate.reset();
    makePreview.reset();
    forget();
  };
  // A preview/video belongs to the photos and framing it was made from:
  // changing either starts over, so the next click can't animate a stale one.
  const changeInput =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      if (previewId || taskId) reset();
    };
  const credits = price?.toLocaleString('en-US') ?? '…';

  return (
    <div className="zt-page">
      <header className="zt-header">
        <Link href="/" className="zt-brand">
          <img
            src={envConfigs.app_logo}
            alt={m['zombie.logo_alt']()}
            width={512}
            height={512}
            className="zt-brand-mark"
          />
          <span>{envConfigs.app_name}</span>
        </Link>
        <nav
          className={menu ? 'zt-nav zt-nav-open' : 'zt-nav'}
          aria-label={m['zombie.nav_label']()}
        >
          <a href="#create" onClick={() => setMenu(false)}>
            {m['zombie.nav.create']()}
          </a>
          <a href="#how" onClick={() => setMenu(false)}>
            {m['zombie.nav.how']()}
          </a>
          <a href="#ideas" onClick={() => setMenu(false)}>
            {m['zombie.nav.ideas']()}
          </a>
          <a href="#faq" onClick={() => setMenu(false)}>
            {m['zombie.nav.faq']()}
          </a>
          <a href="#pricing" onClick={() => setMenu(false)}>
            {m['zombie.nav.pricing']()}
          </a>
        </nav>
        <div className="zt-header-actions">
          {user ? (
            <Suspense fallback={<span className="block size-9" />}>
              <SiteUserMenu
                name={user.name || user.email}
                email={user.email}
                image={user.image}
              />
            </Suspense>
          ) : (
            <Link className="zt-nav-cta" href="/sign-in">
              {m['common.sign.sign_in_title']()} <ArrowRight size={16} />
            </Link>
          )}
          <button
            className="zt-menu"
            onClick={() => setMenu(!menu)}
            aria-label={m['zombie.nav_label']()}
          >
            {menu ? <X /> : <span>☰</span>}
          </button>
        </div>
      </header>

      <main>
        <section className="zt-cover" aria-labelledby="cover-heading">
          <h1 id="cover-heading" className="zt-nameplate">
            <span className="zt-nameplate-word">
              {m['zombie.hero.title']()}
            </span>{' '}
            <span className="zt-deck">{m['zombie.hero.title_sub']()}</span>
          </h1>
          <div className="zt-cover-grid">
            <div className="zt-cover-copy">
              <p className="zt-standfirst">{m['zombie.hero.subtitle']()}</p>
              <a href="#create" className="zt-button">
                {m['zombie.hero.cta']()} <ArrowRight size={18} />
              </a>
              <ul className="zt-coverlines">
                <li>
                  <a href="#story">{m['zombie.cover.line_story']()}</a>
                </li>
                <li>
                  <a href="#how">{m['zombie.cover.line_how']()}</a>
                </li>
                <li>
                  <a href="#prompt">{m['zombie.cover.line_prompt']()}</a>
                </li>
              </ul>
            </div>
            <figure className="zt-cover-photo">
              {/* Preloaded in routes/index.tsx; keep in sync. */}
              <MotionStill
                video={STILL_VIDEOS[HERO_DESKTOP_IMAGE]}
                mobileVideo={STILL_VIDEOS[HERO_MOBILE_IMAGE]}
              >
                <picture>
                  <source
                    media={HERO_MOBILE_MEDIA}
                    srcSet={HERO_MOBILE_IMAGE}
                  />
                  <img
                    src={HERO_DESKTOP_IMAGE}
                    alt={m['zombie.hero.image_alt']()}
                    width={1024}
                    height={496}
                    fetchPriority="high"
                  />
                </picture>
              </MotionStill>
              <figcaption>{m['zombie.hero.sub_cold']()}</figcaption>
            </figure>
          </div>
        </section>

        <section className="zt-facts" aria-label={m['zombie.facts.label']()}>
          <dl>
            {(
              [
                [m['zombie.facts.free'], m['zombie.facts.free_text']],
                [m['zombie.facts.time'], m['zombie.facts.time_text']],
                [m['zombie.facts.format'], m['zombie.facts.format_text']],
                [m['zombie.facts.refund'], m['zombie.facts.refund_text']],
              ] as const
            ).map(([term, text], i) => (
              <div key={i}>
                <dt>{term()}</dt>
                <dd>{text()}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section id="create" className="zt-create">
          <header className="zt-head">
            <h2>{m['zombie.create.title']()}</h2>
            <p className="zt-head-text">{m['zombie.create.description']()}</p>
          </header>
          <div className="zt-create-grid">
            <div className="zt-create-form">
              <div className="zt-form-top">
                <span className="zt-step">{m['zombie.create.photos']()}</span>
                <span>{m['zombie.create.format']()}</span>
              </div>
              <div className="zt-upload-grid">
                <PhotoInput
                  label={m['zombie.create.person_a']()}
                  side={m['zombie.create.left']()}
                  file={photoA}
                  onFile={changeInput(setPhotoA)}
                />
                <PhotoInput
                  label={m['zombie.create.person_b']()}
                  side={m['zombie.create.right']()}
                  file={photoB}
                  onFile={changeInput(setPhotoB)}
                />
              </div>
              <p className="zt-field-label" id="clip-style-label">
                {m['zombie.create.style']()}
              </p>
              <div
                className="zt-styles"
                role="radiogroup"
                aria-labelledby="clip-style-label"
              >
                {(
                  [
                    ['gun', m['zombie.style.gun'], m['zombie.style.gun_desc']],
                    [
                      'cure',
                      m['zombie.style.cure'],
                      m['zombie.style.cure_desc'],
                    ],
                    [
                      'glass',
                      m['zombie.style.glass'],
                      m['zombie.style.glass_desc'],
                    ],
                  ] as const
                ).map(([key, label, desc]) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={style === key}
                    className="zt-style"
                    disabled={running}
                    onClick={() => changeInput(setStyle)(key)}
                  >
                    <span className="zt-style-name">{label()}</span>
                    <span>{desc()}</span>
                  </button>
                ))}
              </div>
              <p className="zt-field-label" id="clip-memory-label">
                {m['zombie.create.memory']()}
              </p>
              <div
                className="zt-memories"
                role="radiogroup"
                aria-labelledby="clip-memory-label"
              >
                {(
                  [
                    ['sunny', m['zombie.memory.sunny']],
                    ['beach', m['zombie.memory.beach']],
                    ['snow', m['zombie.memory.snow']],
                    ['kitchen', m['zombie.memory.kitchen']],
                    ['wedding', m['zombie.memory.wedding']],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={memory === key}
                    className="zt-memory"
                    disabled={running}
                    onClick={() => setMemory(key)}
                  >
                    {label()}
                  </button>
                ))}
              </div>
              <p className="zt-field-label" id="clip-length-label">
                {m['zombie.create.length']()}
              </p>
              <div
                className="zt-sizes"
                role="radiogroup"
                aria-labelledby="clip-length-label"
              >
                {(Object.keys(CLIP_LENGTHS) as ClipLength[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={length === key}
                    className="zt-size"
                    disabled={running}
                    onClick={() => setLength(key)}
                  >
                    <span className="zt-length-seconds">
                      {m['zombie.create.length_seconds']({ seconds: key })}
                    </span>
                    <span>
                      {priceQuery.data?.lengths?.[key]?.toLocaleString(
                        'en-US'
                      ) ?? '…'}{' '}
                      {m['zombie.create.length_credits']()}
                    </span>
                  </button>
                ))}
              </div>
              <label className="zt-field-label" htmlFor="direction">
                {m['zombie.create.direction']()}
              </label>
              <textarea
                id="direction"
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
                maxLength={400}
                placeholder={m['zombie.create.placeholder']()}
              />
              <label className="zt-consent">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                <span>{m['zombie.create.consent']()}</span>
              </label>
              <div className="zt-form-actions">
                {task?.status === 'success' || task?.status === 'failed' ? (
                  <button className="zt-button" type="button" onClick={reset}>
                    {m['zombie.create.again']()} <ArrowRight size={17} />
                  </button>
                ) : previewReady ? (
                  <>
                    <button
                      className={`zt-button ${busyAnimate ? 'zt-disabled' : ''}`}
                      type="button"
                      disabled={busyAnimate}
                      onClick={startAnimate}
                    >
                      {busyAnimate && (
                        <Loader2 size={17} className="animate-spin" />
                      )}
                      {packPrice
                        ? m['zombie.create.animate_price']({ price: packPrice })
                        : m['zombie.create.animate']({ credits })}
                      {!busyAnimate && <ArrowRight size={17} />}
                    </button>
                    <button
                      className="zt-outline"
                      type="button"
                      onClick={reset}
                    >
                      {m['zombie.create.start_over']()}
                    </button>
                  </>
                ) : freeLeft > 0 && !taskId ? (
                  <button
                    className={`zt-button ${!canGenerate || running ? 'zt-disabled' : ''}`}
                    type="button"
                    disabled={!canGenerate || running}
                    onClick={() => makePreview.mutate()}
                  >
                    {running && <Loader2 size={17} className="animate-spin" />}
                    {m['zombie.create.free_preview']()}
                    {!running && <ArrowRight size={17} />}
                  </button>
                ) : !user ? (
                  <Link
                    className="zt-button"
                    href={`/sign-up?callbackUrl=${encodeURIComponent('/#create')}`}
                  >
                    {packPrice
                      ? m['zombie.create.make_price']({ price: packPrice })
                      : m['zombie.create.sign_in']()}{' '}
                    <ArrowRight size={17} />
                  </Link>
                ) : (
                  <button
                    className={`zt-button ${!canGenerate || running ? 'zt-disabled' : ''}`}
                    type="button"
                    disabled={!canGenerate || running}
                    onClick={startGenerate}
                  >
                    {(running || buyPack.isPending) && (
                      <Loader2 size={17} className="animate-spin" />
                    )}
                    {packPrice
                      ? m['zombie.create.make_price']({ price: packPrice })
                      : m['zombie.create.generate']()}
                    {!running && !buyPack.isPending && <ArrowRight size={17} />}
                  </button>
                )}
                {task?.videoUrl && (
                  <>
                    <a
                      className="zt-outline"
                      href={`/api/zombie/download?id=${task.id}`}
                      download
                    >
                      {m['zombie.create.download']()} <Download size={17} />
                    </a>
                    <Link className="zt-outline" href="/settings/videos">
                      {m['zombie.create.my_videos']()}
                    </Link>
                  </>
                )}
              </div>
              {price !== undefined && !previewReady && (
                <p className="zt-hint">
                  {freeLeft > 0 && !previewReady && !taskId
                    ? `${m['zombie.create.free_note']()} `
                    : ''}
                  {m['zombie.create.cost']({ credits })}{' '}
                  <a href="#pricing">{m['zombie.create.buy_credits']()}</a>
                </p>
              )}
              <p className="zt-hint" role="status" aria-live="polite">
                {error
                  ? `${m['zombie.create.failed']()}: ${error}`
                  : freeError
                    ? freeError
                    : task?.status === 'success'
                      ? m['zombie.create.done']()
                      : generate.isPending
                        ? m['zombie.create.submitting']()
                        : task?.stage === 'motion'
                          ? `${m['zombie.create.stage_motion']()} ${m['zombie.create.keep_open']()}`
                          : taskId
                            ? `${m['zombie.create.stage_scene']()} ${m['zombie.create.keep_open']()}`
                            : previewReady
                              ? packPrice
                                ? m['zombie.create.preview_ready_price']({
                                    price: packPrice,
                                  })
                                : m['zombie.create.preview_ready']({ credits })
                              : makePreview.isPending
                                ? m['zombie.create.submitting']()
                                : previewRunning
                                  ? m['zombie.create.preview_working']()
                                  : photoA && photoB
                                    ? m['zombie.create.ready']()
                                    : m['zombie.create.hint']()}
              </p>
            </div>
            <aside className="zt-preview">
              <div className="zt-preview-media">
                {task?.videoUrl ? (
                  <video
                    src={task.videoUrl}
                    poster={task.sceneImageUrl ?? undefined}
                    controls
                    autoPlay
                    playsInline
                  />
                ) : task?.sceneImageUrl ? (
                  <img
                    src={task.sceneImageUrl}
                    alt={m['zombie.hero.image_alt']()}
                    width={1024}
                    height={1536}
                  />
                ) : preview?.imageUrl ? (
                  <WatermarkedImage
                    src={preview.imageUrl}
                    alt={m['zombie.hero.image_alt']()}
                    onError={forget}
                  />
                ) : (
                  <OptImage
                    key={style}
                    src={styleImages[style]}
                    alt={m['zombie.hero.image_alt']()}
                    width={1024}
                    height={1536}
                  />
                )}
              </div>
              <div className="zt-preview-caption">
                <span>{m['zombie.create.preview']()}</span>
                <span>{m['zombie.create.clip']()}</span>
              </div>
              <p>{m['zombie.create.preview_note']()}</p>
            </aside>
          </div>
        </section>

        {exampleVideos.length > 0 && (
          <section
            id="samples"
            className="zt-samples"
            aria-labelledby="samples-heading"
          >
            <div className="zt-samples-grid">
              <header className="zt-samples-intro">
                <p className="zt-kicker">{m['zombie.samples.eyebrow']()}</p>
                <h2 id="samples-heading">{m['zombie.samples.title']()}</h2>
                <p className="zt-head-text">
                  {m['zombie.samples.description']()}
                </p>
                <dl className="zt-samples-spec">
                  {(
                    [
                      [m['zombie.samples.spec_length'], '8s'],
                      [m['zombie.samples.spec_quality'], '720p'],
                      [
                        m['zombie.samples.spec_sound'],
                        m['zombie.samples.spec_sound_value'],
                      ],
                      [
                        m['zombie.samples.spec_edits'],
                        m['zombie.samples.spec_edits_value'],
                      ],
                    ] as const
                  ).map(([term, value], i) => (
                    <div key={i}>
                      <dt>{term()}</dt>
                      <dd>{typeof value === 'string' ? value : value()}</dd>
                    </div>
                  ))}
                </dl>
                <a className="zt-button" href="#create">
                  {m['zombie.samples.cta']()} <ArrowRight size={17} />
                </a>
              </header>
              <ol className="zt-sample-list">
                {exampleVideos.map((v, i) => (
                  <li key={v.key} className="zt-sample">
                    <div className="zt-sample-media">
                      <video
                        src={v.src}
                        poster={v.poster}
                        controls
                        playsInline
                        preload="none"
                        aria-label={v.label()}
                        onPlay={() =>
                          track('zt_sample_play', { sample: v.key })
                        }
                      />
                    </div>
                    <p className="zt-sample-label">
                      <span className="zt-sample-no">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      {v.label()}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        )}

        <section
          id="story"
          className="zt-story"
          aria-labelledby="story-heading"
        >
          <header className="zt-head">
            <p className="zt-kicker">{m['zombie.story.eyebrow']()}</p>
            <h2 id="story-heading">{m['zombie.story.title']()}</h2>
            <p className="zt-head-text">{m['zombie.story.description']()}</p>
          </header>
          <ol className="zt-contact">
            {(
              [
                [
                  beatImages.aim,
                  m['zombie.story.aim.title'],
                  m['zombie.story.aim.text'],
                ],
                [
                  beatImages.recognise,
                  m['zombie.story.recognise.title'],
                  m['zombie.story.recognise.text'],
                ],
                [
                  beatImages.hug,
                  m['zombie.story.hug.title'],
                  m['zombie.story.hug.text'],
                ],
                [
                  beatImages.remember,
                  m['zombie.story.remember.title'],
                  m['zombie.story.remember.text'],
                ],
              ] as const
            ).map(([src, title, text], i) => (
              <li
                key={i}
                className={i === 3 ? 'zt-shot zt-shot-warm' : 'zt-shot'}
              >
                <div className="zt-shot-media">
                  <OptImage src={src} alt="" width={600} height={760} />
                </div>
                <h3>{title()}</h3>
                <p>{text()}</p>
              </li>
            ))}
          </ol>
        </section>

        <article className="zt-article" aria-labelledby="about-heading">
          <header className="zt-head zt-head-center">
            <h2 id="about-heading">{m['zombie.about.title']()}</h2>
          </header>
          <div className="zt-columns">
            <p className="zt-dropcap">{m['zombie.about.one']()}</p>
            <p>{m['zombie.about.two']()}</p>
            <blockquote className="zt-pull">
              {m['zombie.how.quote']()}
            </blockquote>
            <p>{m['zombie.about.three']()}</p>
            <p>{m['zombie.about.four']()}</p>
          </div>
        </article>

        <section id="how" className="zt-how" aria-labelledby="how-heading">
          <header className="zt-head">
            <p className="zt-kicker">{m['zombie.how.eyebrow']()}</p>
            <h2 id="how-heading">{m['zombie.how.title']()}</h2>
          </header>
          <ol className="zt-steps">
            {(
              [
                [m['zombie.how.one.title'], m['zombie.how.one.text']],
                [m['zombie.how.two.title'], m['zombie.how.two.text']],
                [m['zombie.how.three.title'], m['zombie.how.three.text']],
              ] as const
            ).map(([title, text], i) => (
              <li key={i}>
                <h3>{title()}</h3>
                <p>{text()}</p>
              </li>
            ))}
          </ol>
        </section>

        <section
          id="ideas"
          className="zt-ideas"
          aria-labelledby="ideas-heading"
        >
          <header className="zt-head">
            <p className="zt-kicker">{m['zombie.ideas.eyebrow']()}</p>
            <h2 id="ideas-heading">{m['zombie.ideas.title']()}</h2>
            <p className="zt-head-text">{m['zombie.ideas.description']()}</p>
          </header>
          <div className="zt-features">
            <article className="zt-feature-lead">
              <div className="zt-feature-media">
                <OptImage
                  src={coupleImage}
                  alt={m['zombie.ideas.couples.image_alt']()}
                  width={940}
                  height={547}
                />
              </div>
              <h3>{m['zombie.ideas.couples.title']()}</h3>
              <p>{m['zombie.ideas.couples.text']()}</p>
            </article>
            <div className="zt-feature-side">
              {(
                [
                  [
                    'dog',
                    dogImage,
                    m['zombie.ideas.dog.image_alt'],
                    m['zombie.ideas.dog.title'],
                    m['zombie.ideas.dog.text'],
                  ],
                  [
                    'cat',
                    catImage,
                    m['zombie.ideas.cat.image_alt'],
                    m['zombie.ideas.cat.title'],
                    m['zombie.ideas.cat.text'],
                  ],
                ] as const
              ).map(([key, src, alt, title, text]) => (
                <article key={key} className="zt-feature-small">
                  <div className="zt-feature-media">
                    <OptImage src={src} alt={alt()} width={940} height={547} />
                  </div>
                  <div>
                    <h3>{title()}</h3>
                    <p>{text()}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="zt-compare" aria-labelledby="compare-heading">
          <header className="zt-head zt-head-center">
            <h2 id="compare-heading">{m['zombie.compare.title']()}</h2>
          </header>
          <table className="zt-table">
            <thead>
              <tr>
                <th scope="col">{m['zombie.compare.diy']()}</th>
                <th scope="col">{m['zombie.compare.zt']()}</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  [m['zombie.compare.diy_1'], m['zombie.compare.zt_1']],
                  [m['zombie.compare.diy_2'], m['zombie.compare.zt_2']],
                  [m['zombie.compare.diy_3'], m['zombie.compare.zt_3']],
                  [m['zombie.compare.diy_4'], m['zombie.compare.zt_4']],
                ] as const
              ).map(([diy, ours], i) => (
                <tr key={i}>
                  <td>{diy()}</td>
                  <td>{ours()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section
          id="prompt"
          className="zt-prompt"
          aria-labelledby="prompt-heading"
        >
          <div className="zt-prompt-copy">
            <header className="zt-head">
              <h2 id="prompt-heading">{m['zombie.prompt.title']()}</h2>
            </header>
            <p>{m['zombie.prompt.one']()}</p>
            <p>{m['zombie.prompt.two']()}</p>
            <h3>{m['zombie.guide.title']()}</h3>
            <dl className="zt-tips">
              {(
                [
                  [
                    m['zombie.guide.photos.title'],
                    m['zombie.guide.photos.text'],
                  ],
                  [
                    m['zombie.guide.motion.title'],
                    m['zombie.guide.motion.text'],
                  ],
                  [
                    m['zombie.guide.review.title'],
                    m['zombie.guide.review.text'],
                  ],
                ] as const
              ).map(([term, text], i) => (
                <div key={i}>
                  <dt>{term()}</dt>
                  <dd>{text()}</dd>
                </div>
              ))}
            </dl>
          </div>
          <CopyPrompt />
        </section>

        <Pricing />

        {paywallMounted && (
          <Suspense fallback={null}>
            <PaywallDialog
              open={paywall}
              onOpenChange={setPaywall}
              note={
                creditsQuery.data &&
                price !== undefined &&
                creditsQuery.data.balance < price
                  ? m['zombie.paywall.low_balance']({
                      balance:
                        creditsQuery.data.balance.toLocaleString('en-US'),
                      credits,
                      seconds: CLIP_LENGTHS[length],
                    })
                  : undefined
              }
            />
          </Suspense>
        )}

        <section id="faq" className="zt-faq" aria-labelledby="faq-heading">
          <header className="zt-head zt-head-center">
            <p className="zt-kicker">{m['zombie.faq.eyebrow']()}</p>
            <h2 id="faq-heading">{m['zombie.faq.title']()}</h2>
          </header>
          <div className="zt-faq-list">
            {/* Static message refs: a template-literal key (m[`…${x}`])
                pulls every message of both locales into the client bundle. */}
            {[
              [m['zombie.faq.zero.question'], m['zombie.faq.zero.answer']],
              [m['zombie.faq.one.question'], m['zombie.faq.one.answer']],
              [m['zombie.faq.two.question'], m['zombie.faq.two.answer']],
              [m['zombie.faq.three.question'], m['zombie.faq.three.answer']],
              [m['zombie.faq.four.question'], m['zombie.faq.four.answer']],
              [m['zombie.faq.five.question'], m['zombie.faq.five.answer']],
              [m['zombie.faq.six.question'], m['zombie.faq.six.answer']],
              [m['zombie.faq.seven.question'], m['zombie.faq.seven.answer']],
              [m['zombie.faq.eight.question'], m['zombie.faq.eight.answer']],
            ].map(([question, answer], item) => (
              <details key={item}>
                <summary>{question()}</summary>
                <p>{answer()}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="zt-closing" aria-labelledby="closing-heading">
          <figure className="zt-closing-photo">
            <OptImage src={coupleImage} alt="" width={940} height={547} />
          </figure>
          <div className="zt-closing-copy">
            <h2 id="closing-heading">{m['zombie.bottom.title']()}</h2>
            <p>{m['zombie.bottom.text']()}</p>
            <a className="zt-button" href="#create">
              {m['zombie.bottom.cta']()} <ArrowRight size={18} />
            </a>
          </div>
        </section>
      </main>
      <footer className="zt-footer">
        <div className="zt-colophon">
          <Link href="/" className="zt-footer-name">
            {envConfigs.app_name}
          </Link>
          <p>{m['zombie.footer.line']()}</p>
        </div>
        <div className="zt-footer-links">
          <a href="mailto:support@zombietrend.org">support@zombietrend.org</a>
          <Link href="/pricing">{m['zombie.nav.pricing']()}</Link>
          <Link href="/privacy-policy">{m['landing.footer.privacy']()}</Link>
          <Link href="/terms-of-service">{m['landing.footer.terms']()}</Link>
          <Link href="/acceptable-use-policy">{m['landing.footer.aup']()}</Link>
        </div>
        <FooterBadgeList className="basis-full" />
      </footer>
    </div>
  );
}

function CopyPrompt() {
  const [copied, setCopied] = useState(false);
  const text = m['zombie.prompt.copy_text']();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(m['zombie.prompt.copied']());
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the prompt stays selectable in the block.
    }
  };

  return (
    <div className="zt-copy-prompt">
      <pre>{text}</pre>
      <button type="button" className="zt-button" onClick={copy}>
        {copied ? <Check size={18} /> : <Copy size={18} />}
        {copied ? m['zombie.prompt.copied']() : m['zombie.prompt.copy']()}
      </button>
    </div>
  );
}
