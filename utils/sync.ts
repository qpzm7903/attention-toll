import type {
  GraceState,
  PendingRelaxation,
  Settings,
  TollRecord,
  UsageMap,
} from './types';

/** sync 配额约束（总 100KB / 单键 8KB）下每设备的同步范围，见 ADR-0004 */
const SYNC_DAYS = 35;
const SYNC_RECORDS = 30;
const SYNC_TEXT_MAX = 140;

export async function getDeviceId(): Promise<string> {
  const res = await browser.storage.local.get('deviceId');
  if (res.deviceId) return res.deviceId as string;
  const id = crypto.randomUUID().slice(0, 8);
  await browser.storage.local.set({ deviceId: id });
  return id;
}

async function syncGet<T>(key: string): Promise<T | undefined> {
  try {
    const res = await browser.storage.sync.get(key);
    return res[key] as T | undefined;
  } catch {
    return undefined;
  }
}

async function syncSet(items: Record<string, unknown>) {
  try {
    await browser.storage.sync.set(items);
  } catch {
    // 未登录 / 配额超限：退化为单机模式，本地数据不受影响
  }
}

async function syncGetAll(): Promise<Record<string, unknown>> {
  try {
    return await browser.storage.sync.get(null);
  } catch {
    return {};
  }
}

export async function pushUsage(usage: UsageMap) {
  const id = await getDeviceId();
  const days = Object.keys(usage).sort().slice(-SYNC_DAYS);
  await syncSet({
    ['u:' + id]: Object.fromEntries(days.map((d) => [d, usage[d]])),
  });
}

export async function pushRecords(records: TollRecord[]) {
  const id = await getDeviceId();
  const trimmed = records
    .slice(-SYNC_RECORDS)
    .map((r) => ({ ...r, text: r.text.slice(0, SYNC_TEXT_MAX) }));
  await syncSet({ ['r:' + id]: trimmed });
}

export async function pushGrace(grace: GraceState) {
  await syncSet({ 's:grace': grace });
}

export const pullGrace = () => syncGet<GraceState>('s:grace');

export interface SyncedSettings {
  settings: Settings;
  pending: PendingRelaxation | null;
  ts: number;
}

export async function pushSettings(payload: SyncedSettings) {
  await syncSet({ 's:settings': payload });
}

export const pullSettings = () => syncGet<SyncedSettings>('s:settings');

/** 合并视图：本机全量 + 其他设备分账。本机的 sync 副本被跳过，避免重复计数 */
export async function mergedUsage(localUsage: UsageMap): Promise<UsageMap> {
  const id = await getDeviceId();
  const all = await syncGetAll();
  const merged: UsageMap = JSON.parse(JSON.stringify(localUsage));
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith('u:') || key === 'u:' + id) continue;
    for (const [day, du] of Object.entries(value as UsageMap)) {
      const target = merged[day] ?? (merged[day] = { total: 0, perSite: {} });
      target.total += du.total;
      for (const [site, sec] of Object.entries(du.perSite)) {
        target.perSite[site] = (target.perSite[site] ?? 0) + sec;
      }
    }
  }
  return merged;
}

export async function mergedRecords(
  localRecords: TollRecord[],
): Promise<TollRecord[]> {
  const id = await getDeviceId();
  const all = await syncGetAll();
  const merged = [...localRecords];
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith('r:') || key === 'r:' + id) continue;
    merged.push(...(value as TollRecord[]));
  }
  return merged.sort((a, b) => a.ts - b.ts);
}
