import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { parseFooterBadgeMarkup } from '@/features/footer-badges/markup';
import {
  MAX_FOOTER_BADGES,
  type FooterBadge,
} from '@/features/footer-badges/types';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { apiGet, apiPost } from '@/lib/api-client';
import { m } from '@/paraglide/messages.js';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

const queryKey = ['admin-footer-badges'];

function AdminFooterBadgesPage() {
  const queryClient = useQueryClient();
  const [markup, setMarkup] = useState('');
  const [inputError, setInputError] = useState(false);
  const {
    data: badges = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey,
    queryFn: () => apiGet<FooterBadge[]>('/api/admin/footer-badges'),
  });

  const saveMutation = useMutation({
    mutationFn: (
      change:
        | { action: 'add'; badges: FooterBadge[] }
        | { action: 'remove'; badge: FooterBadge }
    ) =>
      apiPost<FooterBadge[]>('/api/admin/footer-badges', {
        ...change,
      }),
    onSuccess: (savedBadges) => {
      queryClient.setQueryData(queryKey, savedBadges);
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['public-config'] });
      toast.success(m['admin.footer_badges.saved']());
      setMarkup('');
      setInputError(false);
    },
    onError: (error: Error) => {
      toast.error(error.message || m['admin.footer_badges.save_error']());
      queryClient.invalidateQueries({ queryKey });
    },
  });

  useEffect(() => {
    if (isError) toast.error(m['admin.footer_badges.load_error']());
  }, [isError]);

  function addBadge() {
    setInputError(false);
    try {
      const parsed = parseFooterBadgeMarkup(markup);
      if (
        new Set([...badges, ...parsed].map((b) => b.href)).size >
        MAX_FOOTER_BADGES
      ) {
        setInputError(true);
        return;
      }
      saveMutation.mutate({ action: 'add', badges: parsed });
    } catch {
      setInputError(true);
    }
  }

  function removeBadge(index: number) {
    saveMutation.mutate({ action: 'remove', badge: badges[index] });
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {m['admin.footer_badges.title']()}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {m['admin.footer_badges.description']()}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{m['admin.footer_badges.add_title']()}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label htmlFor="footer-badge-markup" className="text-sm font-medium">
            {m['admin.footer_badges.code_label']()}
          </label>
          <Textarea
            id="footer-badge-markup"
            value={markup}
            onChange={(event) => {
              setMarkup(event.target.value);
              setInputError(false);
            }}
            placeholder={m['admin.footer_badges.code_placeholder']()}
            rows={6}
            aria-invalid={inputError}
            aria-describedby="footer-badge-help"
            className="font-mono text-xs"
            disabled={saveMutation.isPending}
          />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p
              id="footer-badge-help"
              className={
                inputError
                  ? 'text-destructive text-sm'
                  : 'text-muted-foreground text-sm'
              }
            >
              {inputError
                ? m['admin.footer_badges.invalid_code']()
                : m['admin.footer_badges.code_help']({
                    max: MAX_FOOTER_BADGES,
                  })}
            </p>
            <Button
              type="button"
              onClick={addBadge}
              disabled={
                saveMutation.isPending || isLoading || isError || !markup.trim()
              }
            >
              {saveMutation.isPending ? (
                m['admin.footer_badges.adding']()
              ) : (
                <>
                  <Plus data-icon="inline-start" />
                  {m['admin.footer_badges.add_button']()}
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{m['admin.footer_badges.current_title']()}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground text-sm">
              {m['admin.footer_badges.loading']()}
            </p>
          ) : badges.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {m['admin.footer_badges.empty']()}
            </p>
          ) : (
            <ul className="space-y-3">
              {badges.map((badge, index) => (
                <li
                  key={`${index}:${badge.href}:${badge.src}`}
                  className="flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-2">
                    <div className="flex min-h-12 items-center">
                      {badge.src ? (
                        <img
                          src={badge.src}
                          alt={badge.alt}
                          width={badge.width ?? 250}
                          height={badge.height}
                          className="h-auto max-h-16 max-w-full"
                        />
                      ) : (
                        <span>{badge.text || badge.alt}</span>
                      )}
                    </div>
                    <p className="text-muted-foreground truncate text-xs">
                      {badge.href}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={saveMutation.isPending}
                    onClick={() => removeBadge(index)}
                    aria-label={m['admin.footer_badges.remove']()}
                  >
                    <Trash2 data-icon="inline-start" />
                    {m['admin.footer_badges.remove']()}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export const Route = createFileRoute('/admin/footer-badges')({
  component: AdminFooterBadgesPage,
});
