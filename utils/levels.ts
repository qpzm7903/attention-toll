import type { GraceState, InterventionLevel, Thresholds } from './types';

export function levelFor(
  totalSeconds: number,
  t: Thresholds,
): InterventionLevel {
  const m = totalSeconds / 60;
  if (m >= t.l4) return 4;
  if (m >= t.l3) return 3;
  if (m >= t.l2) return 2;
  if (m >= t.l1) return 1;
  return 0;
}

/** 各等级付出代价后的放行时长（分钟）。L2 的 15 分钟恰好衔接默认的 L3 阈值 */
export const GRACE_MINUTES: Record<number, number> = { 2: 15, 3: 10, 4: 5 };

/** 各等级拦截页的强制等待秒数 */
export const WAIT_SECONDS: Record<number, number> = { 2: 10, 3: 20, 4: 30 };

export const COMMITMENT_PHRASE = '我选择用注意力交换娱乐';

export function isBlocked(
  level: InterventionLevel,
  grace: GraceState,
  now: number = Date.now(),
): boolean {
  if (level < 2) return false;
  return !(grace.ackLevel >= level && grace.until > now);
}

export function shouldShowToast(
  level: InterventionLevel,
  grace: GraceState,
): boolean {
  return level === 1 && grace.ackLevel < 1;
}
