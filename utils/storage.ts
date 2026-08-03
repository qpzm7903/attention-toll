import type {
  GraceState,
  PendingRelaxation,
  Settings,
  TollRecord,
  UsageMap,
} from './types';

export const DEFAULT_SETTINGS: Settings = {
  sites: ['bilibili.com', 'zhihu.com'],
  thresholds: { l1: 30, l2: 45, l3: 60, l4: 90 },
};

const EMPTY_GRACE: GraceState = { ackLevel: 0, until: 0 };

async function get<T>(key: string, fallback: T): Promise<T> {
  const res = await browser.storage.local.get(key);
  return (res[key] as T) ?? fallback;
}

export const getSettings = () => get<Settings>('settings', DEFAULT_SETTINGS);
export const setSettings = (s: Settings) =>
  browser.storage.local.set({ settings: s });

export const getUsage = () => get<UsageMap>('usage', {});
export const setUsage = (u: UsageMap) => browser.storage.local.set({ usage: u });

export const getGrace = () => get<GraceState>('grace', EMPTY_GRACE);
export const setGrace = (g: GraceState) => browser.storage.local.set({ grace: g });

export const getPending = () =>
  get<PendingRelaxation | null>('pending', null);
export const setPending = (p: PendingRelaxation | null) =>
  browser.storage.local.set({ pending: p });

export const getTollRecords = () => get<TollRecord[]>('tollRecords', []);
export async function addTollRecord(record: TollRecord) {
  const records = await getTollRecords();
  records.push(record);
  await browser.storage.local.set({ tollRecords: records.slice(-500) });
}

export async function ensureDefaults() {
  const res = await browser.storage.local.get('settings');
  if (!res.settings) await setSettings(DEFAULT_SETTINGS);
}

/** url 的 hostname 命中哪个分心网站（后缀匹配，支持子域名），未命中返回 null */
export function matchSite(url: string, sites: string[]): string | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  for (const site of sites) {
    if (host === site || host.endsWith('.' + site)) return site;
  }
  return null;
}
