import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Download, Film, Loader2 } from 'lucide-react';

import { Link } from '@/core/i18n/navigation';
import { apiGet, type PageResult } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type VideoRow = {
  id: string;
  status: 'pending' | 'processing' | 'success' | 'failed';
  sceneImageUrl: string | null;
  videoUrl: string | null;
  createdAt: string;
};

const PAGE_SIZE = 12;

function statusText(status: VideoRow['status']) {
  if (status === 'pending') return m['settings.videos.status_pending']();
  if (status === 'processing') return m['settings.videos.status_processing']();
  return m['settings.videos.status_failed']();
}

function VideosPage() {
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ['zombie-videos', page],
    queryFn: () =>
      apiGet<PageResult<VideoRow>>(
        `/api/zombie/videos?page=${page}&pageSize=${PAGE_SIZE}`
      ),
    placeholderData: keepPreviousData,
    // Unfinished videos keep moving server-side; refresh until they land.
    refetchInterval: (q) =>
      q.state.data?.items.some(
        (v) => v.status === 'pending' || v.status === 'processing'
      )
        ? 15_000
        : false,
  });
  const rows = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">{m['settings.videos.title']()}</h1>
        <p className="text-muted-foreground">
          {m['settings.videos.description']()}
        </p>
      </div>

      {query.isPending ? (
        <Loader2 className="text-muted-foreground size-5 animate-spin" />
      ) : rows.length === 0 ? (
        <Card className="max-w-md">
          <CardContent className="flex flex-col items-start gap-4">
            <p className="text-muted-foreground">
              {m['settings.videos.empty']()}
            </p>
            <Link href="/#create" className={cn(buttonVariants(), 'gap-2')}>
              <Film className="size-4" />
              {m['settings.videos.create']()}
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((v) => (
            <Card key={v.id} className="overflow-hidden py-0">
              <div className="bg-muted aspect-[9/16] w-full">
                {v.status === 'success' && v.videoUrl ? (
                  <video
                    src={v.videoUrl}
                    poster={v.sceneImageUrl ?? undefined}
                    controls
                    playsInline
                    preload="metadata"
                    className="size-full bg-black object-contain"
                  />
                ) : v.sceneImageUrl ? (
                  <img
                    src={v.sceneImageUrl}
                    alt=""
                    className="size-full object-cover opacity-60"
                  />
                ) : null}
              </div>
              <CardContent className="flex items-center justify-between gap-2 pb-4">
                <span className="text-muted-foreground text-sm">
                  {new Date(v.createdAt).toLocaleString()}
                </span>
                {v.status === 'success' && v.videoUrl ? (
                  <a
                    href={`/api/zombie/download?id=${v.id}`}
                    download
                    className={cn(
                      buttonVariants({ variant: 'outline', size: 'sm' }),
                      'gap-1.5'
                    )}
                  >
                    <Download className="size-4" />
                    {m['settings.videos.download']()}
                  </a>
                ) : (
                  <span
                    className={cn(
                      'text-sm',
                      v.status === 'failed'
                        ? 'text-destructive'
                        : 'text-muted-foreground'
                    )}
                  >
                    {statusText(v.status)}
                  </span>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center gap-3">
          <button
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {m['settings.videos.prev']()}
          </button>
          <span className="text-muted-foreground text-sm">
            {page} / {pages}
          </span>
          <button
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            {m['settings.videos.next']()}
          </button>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/settings/videos')({
  component: VideosPage,
});
