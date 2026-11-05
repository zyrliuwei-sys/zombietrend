/**
 * Evolink answers 402 when *our* account balance can't cover a run. That's
 * not the buyer's fault and the raw message ("please top up at evolink.ai…")
 * confuses them, so it is swapped for SERVICE_BUSY (the page says the service
 * is busy and the credits went back) and the operator gets an email to top up.
 */

import type { EvolinkProvider } from '@/core/ai/evolink';
import { getEmailProvider } from '@/core/auth';
import { envConfigs } from '@/config';
import {
  evolinkCostUsd,
  type ClipLength,
  type VideoResolution,
} from '@/config/zombie-pricing';
import { getAllConfigs, saveConfigs } from '@/modules/config/service';

export const SERVICE_BUSY = 'SERVICE_BUSY';
export const CONTENT_BLOCKED = 'CONTENT_BLOCKED';

const ALERT_AT_KEY = 'evolink_funds_alert_at';
const ALERT_INTERVAL_MS = 60 * 60 * 1000;

// Evolink reports its balance in provider credits (about $0.0147 each). Keep
// a small buffer because the provider pre-authorizes a request at its maximum
// estimated cost. The actual cost is recorded on the task after completion.
const PROVIDER_CREDIT_USD = 0.0147;
const PROVIDER_BALANCE_BUFFER = 1.15;

export function isOutOfFunds(error: any) {
  const message = String(error?.message ?? error ?? '');
  return (
    /request failed with status: 402\b/.test(message) ||
    /insufficient account balance/i.test(message)
  );
}

function isContentBlocked(error: any) {
  const message = String(error?.message ?? error ?? '');
  return /content policy|safety filters?|content (?:or asset )?rejected/i.test(
    message
  );
}

function estimatedProviderCredits(params: {
  length?: ClipLength;
  resolution?: VideoResolution;
  sceneOnly?: boolean;
}) {
  const estimatedUsd = params.sceneOnly
    ? 0.04
    : evolinkCostUsd(
        params.length === '12' ? 12 : params.length === '15' ? 15 : 8,
        params.resolution ?? '720p'
      );
  return Math.ceil(
    (estimatedUsd / PROVIDER_CREDIT_USD) * PROVIDER_BALANCE_BUFFER
  );
}

/**
 * Avoid starting a user task when Evolink cannot pre-authorize the run.
 *
 * A balance lookup failure is treated as unknown and allowed through; the
 * normal 402 handling remains the fallback for transient provider issues.
 */
export async function ensureProviderFunds(
  provider: EvolinkProvider,
  params: {
    length?: ClipLength;
    resolution?: VideoResolution;
    sceneOnly?: boolean;
  }
) {
  const needed = estimatedProviderCredits(params);
  try {
    const { remainingCredits } = await provider.getCredits();
    if (remainingCredits === null || remainingCredits >= needed) return true;

    await alertOutOfFunds(
      `Evolink balance ${remainingCredits.toFixed(2)} credits is below the estimated ${needed} credits required for this run.`
    );
    return false;
  } catch (error) {
    console.error('[evolink] balance preflight unavailable', error);
    return true;
  }
}

/**
 * Email `ops_alert_email` that the Evolink balance ran out, at most once an
 * hour. Never throws — it runs on a request that has already failed.
 */
export async function alertOutOfFunds(detail: string) {
  try {
    const configs = await getAllConfigs();
    const last = Number(configs[ALERT_AT_KEY]) || 0;
    if (Date.now() - last < ALERT_INTERVAL_MS) return;
    const to = configs.ops_alert_email;
    const emailCtx = getEmailProvider(configs);
    if (!to || !emailCtx) {
      console.error('[evolink] balance exhausted, no alert email set', detail);
      return;
    }
    await saveConfigs({ [ALERT_AT_KEY]: String(Date.now()) });

    const appName = configs.app_name || envConfigs.app_name;
    const result = await emailCtx.provider.sendEmail({
      to,
      subject: `[${appName}] Evolink 余额不足，视频生成失败`,
      text: [
        'Evolink 返回 402（账户余额不足），用户的视频/预览生成失败了，付费任务的积分已自动退回。',
        '请尽快充值：https://evolink.ai/dashboard/credits',
        '',
        `原始报错：${detail}`,
        '',
        '（一小时内最多提醒一次）',
      ].join('\n'),
    });
    if (!result.success) {
      console.error('[evolink] balance alert email failed:', result.error);
    }
  } catch (e) {
    console.error('[evolink] balance alert error:', e);
  }
}

/**
 * The error to store/show for a failed provider call: SERVICE_BUSY (plus an
 * operator alert) when our balance ran out, else the provider's message.
 */
export async function userFacingError(error: any, fallback: string) {
  const message = String(error?.message ?? error ?? '') || fallback;
  if (isContentBlocked(message)) return CONTENT_BLOCKED;
  if (!isOutOfFunds(message)) return message;
  await alertOutOfFunds(message);
  return SERVICE_BUSY;
}
