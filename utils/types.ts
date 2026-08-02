/** 干预等级触发阈值，单位分钟（对应 L1~L4） */
export interface Thresholds {
  l1: number;
  l2: number;
  l3: number;
  l4: number;
}

export interface Settings {
  /** 分心网站域名列表，如 "bilibili.com"，按后缀匹配子域名 */
  sites: string[];
  thresholds: Thresholds;
}

/** 放宽方向的设置修改，延迟到次日重置点生效（ADR-0002 不对称生效） */
export interface PendingRelaxation {
  applyAt: number;
  target: Settings;
}

/** 单个注意力日的消耗，单位秒。total 为共享池总量，perSite 仅用于分项展示 */
export interface DayUsage {
  total: number;
  perSite: Record<string, number>;
}

export type UsageMap = Record<string, DayUsage>;

/** 用户为某干预等级付出代价后获得的放行状态 */
export interface GraceState {
  ackLevel: number;
  /** 放行截止时间戳；到期或等级上升后重新拦截 */
  until: number;
}

/** L2 意图询问的回答记录 */
export interface IntentEntry {
  ts: number;
  text: string;
}

export type InterventionLevel = 0 | 1 | 2 | 3 | 4;

/** content script 轮询后台得到的当前状态 */
export interface SiteState {
  tracked: boolean;
  site?: string;
  level: InterventionLevel;
  todaySeconds: number;
  thresholds: Thresholds;
  grace: GraceState;
  blocked: boolean;
  showToast: boolean;
}
