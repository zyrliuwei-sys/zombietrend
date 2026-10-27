/**
 * Evolink answers 402 when *our* account balance can't cover a run. That's
 * not the buyer's fault and the raw message ("please top up at evolink.ai…")
 * confuses them, so it is swapped for SERVICE_BUSY (the page says the service
 * is busy and the credits went back) and the operator gets an email to top up.
 */

import { getEmailProvider } from '@/core/auth';
import { envConfigs } from '@/config';
import { getAllConfigs, saveConfigs } from '@/modules/config/service';

export const SERVICE_BUSY = 'SERVICE_BUSY';

const ALERT_AT_KEY = 'evolink_funds_alert_at';
const ALERT_INTERVAL_MS = 60 * 60 * 1000;

export function isOutOfFunds(error: any) {
  const message = String(error?.message ?? error ?? '');
  return (
    /request failed with status: 402\b/.test(message) ||
    /insufficient account balance/i.test(message)
  );
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
  if (!isOutOfFunds(message)) return message;
  await alertOutOfFunds(message);
  return SERVICE_BUSY;
}
