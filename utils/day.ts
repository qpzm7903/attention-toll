/** 注意力日以凌晨 4 点为界：熬夜消耗计入前一天（见 CONTEXT.md「注意力日」） */
export const DAY_BOUNDARY_HOUR = 4;

export function attentionDay(now: number = Date.now()): string {
  const d = new Date(now - DAY_BOUNDARY_HOUR * 3600_000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function nextResetTime(now: number = Date.now()): number {
  const d = new Date(now);
  const reset = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    DAY_BOUNDARY_HOUR,
    0,
    0,
    0,
  );
  if (reset.getTime() <= now) reset.setDate(reset.getDate() + 1);
  return reset.getTime();
}

/** 最近 n 个注意力日的 key，含今天，从旧到新 */
export function recentDays(n: number, now: number = Date.now()): string[] {
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    days.push(attentionDay(now - i * 24 * 3600_000));
  }
  return days;
}
