import {
  addTollRecord,
  ensureDefaults,
  getGrace,
  getPending,
  getSettings,
  getUsage,
  matchSite,
  setGrace,
  setPending,
  getTollRecords,
  setSettings,
  setUsage,
} from '@/utils/storage';
import { attentionDay, nextResetTime } from '@/utils/day';
import {
  GRACE_MINUTES,
  isBlocked,
  levelFor,
  shouldShowToast,
} from '@/utils/levels';
import type { Settings, SiteState, Thresholds } from '@/utils/types';

/** 计时粒度：chrome.alarms 允许的最小周期 */
const TICK_SECONDS = 30;

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(init);
  browser.runtime.onStartup.addListener(init);

  async function init() {
    await ensureDefaults();
    browser.idle.setDetectionInterval(60);
    await browser.alarms.create('tick', {
      periodInMinutes: TICK_SECONDS / 60,
    });
    await browser.alarms.create('daily-reset', { when: nextResetTime() });
    await updateBadge();
  }

  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'tick') await tick();
    if (alarm.name === 'daily-reset') await dailyReset();
  });

  /**
   * 每 30 秒采样一次：命中计时条件的分心网站各记 30 秒（perSite），
   * 共享池 total 只记一次 30 秒（见 CONTEXT.md「注意力预算」）。
   */
  async function tick() {
    const settings = await getSettings();
    const active = new Set<string>();

    // 条件一：前台激活 + 窗口聚焦 + 非空闲
    const idleState = await browser.idle.queryState(60);
    if (idleState === 'active') {
      const [tab] = await browser.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      if (tab?.url && tab.windowId !== undefined) {
        try {
          const win = await browser.windows.get(tab.windowId);
          if (win.focused) {
            const site = matchSite(tab.url, settings.sites);
            if (site) active.add(site);
          }
        } catch {
          // 窗口在查询间隙被关闭，忽略本次采样
        }
      }
    }

    // 条件二：正在出声的标签页，即使在后台也计时（后台播放场景）
    const audibleTabs = await browser.tabs.query({ audible: true });
    for (const tab of audibleTabs) {
      if (!tab.url) continue;
      const site = matchSite(tab.url, settings.sites);
      if (site) active.add(site);
    }

    if (active.size > 0) {
      const usage = await getUsage();
      const day = attentionDay();
      const dayUsage = usage[day] ?? { total: 0, perSite: {} };
      dayUsage.total += TICK_SECONDS;
      for (const site of active) {
        dayUsage.perSite[site] = (dayUsage.perSite[site] ?? 0) + TICK_SECONDS;
      }
      usage[day] = dayUsage;
      await setUsage(usage);
    }
    await updateBadge();
  }

  /** 凌晨 4 点：应用待生效的放宽设置（ADR-0002），清空放行状态 */
  async function dailyReset() {
    const pending = await getPending();
    if (pending && pending.applyAt <= Date.now()) {
      await setSettings(pending.target);
      await setPending(null);
    }
    await setGrace({ ackLevel: 0, until: 0 });
    await browser.alarms.create('daily-reset', { when: nextResetTime() });
    await updateBadge();
  }

  async function todaySeconds(): Promise<number> {
    const usage = await getUsage();
    return usage[attentionDay()]?.total ?? 0;
  }

  async function updateBadge() {
    const seconds = await todaySeconds();
    const minutes = Math.floor(seconds / 60);
    await browser.action.setBadgeText({
      text: minutes > 0 ? String(minutes) : '',
    });
    const settings = await getSettings();
    const level = levelFor(seconds, settings.thresholds);
    const colors = ['#4a90d9', '#e6a23c', '#e6702c', '#d9534f', '#8b1a1a'];
    await browser.action.setBadgeBackgroundColor({ color: colors[level] });
  }

  /**
   * 不对称生效（ADR-0002）：收紧（加网站、降阈值）立即生效，
   * 放宽（删网站、提阈值）存入 pending，次日 4 点生效。
   */
  async function applySettingsChange(requested: Settings) {
    const current = await getSettings();
    const addedSites = requested.sites.filter(
      (s) => !current.sites.includes(s),
    );
    const immediate: Settings = {
      sites: [...current.sites, ...addedSites],
      thresholds: Object.fromEntries(
        (Object.keys(current.thresholds) as (keyof Thresholds)[]).map((k) => [
          k,
          Math.min(current.thresholds[k], requested.thresholds[k]),
        ]),
      ) as unknown as Thresholds,
    };
    await setSettings(immediate);

    const hasRelaxation =
      JSON.stringify(immediate) !== JSON.stringify(requested);
    if (hasRelaxation) {
      await setPending({ applyAt: nextResetTime(), target: requested });
    } else {
      await setPending(null);
    }
    await updateBadge();
    return { settings: immediate, pendingAt: hasRelaxation ? nextResetTime() : null };
  }

  browser.runtime.onMessage.addListener((message, sender) => {
    return (async () => {
      switch (message?.type) {
        case 'get-state': {
          const settings = await getSettings();
          const site = sender.url
            ? matchSite(sender.url, settings.sites)
            : null;
          const seconds = await todaySeconds();
          const level = levelFor(seconds, settings.thresholds);
          const grace = await getGrace();
          const records = await getTollRecords();
          const state: SiteState = {
            tracked: !!site,
            site: site ?? undefined,
            level,
            todaySeconds: seconds,
            thresholds: settings.thresholds,
            grace,
            blocked: !!site && isBlocked(level, grace),
            showToast: !!site && shouldShowToast(level, grace),
            lastRecord: records[records.length - 1] ?? null,
          };
          return state;
        }
        case 'acknowledge': {
          // 拦截页出口：两条路都必须书写；只有「继续访问」发放行时段
          const level: number = message.level;
          const outcome: 'continued' | 'left' = message.outcome ?? 'continued';
          if (message.text) {
            await addTollRecord({
              ts: Date.now(),
              site: message.site ?? '',
              level,
              text: message.text,
              outcome,
            });
          }
          if (level === 1) {
            await setGrace({ ackLevel: 1, until: nextResetTime() });
          } else if (outcome === 'continued') {
            const graceMinutes = GRACE_MINUTES[level] ?? 0;
            await setGrace({
              ackLevel: level,
              until: Date.now() + graceMinutes * 60_000,
            });
          }
          return { ok: true };
        }
        case 'update-settings':
          return applySettingsChange(message.settings as Settings);
        default:
          return undefined;
      }
    })();
  });
});
