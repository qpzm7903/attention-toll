<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';
import { recentDays } from '@/utils/day';
import {
  getPending,
  getSettings,
  getTollRecords,
  getUsage,
} from '@/utils/storage';
import type {
  PendingRelaxation,
  Settings,
  TollRecord,
  UsageMap,
} from '@/utils/types';

const usage = ref<UsageMap>({});
const settings = ref<Settings>({
  sites: [],
  thresholds: { l1: 30, l2: 45, l3: 60, l4: 90 },
});
const pending = ref<PendingRelaxation | null>(null);
const records = ref<TollRecord[]>([]);
const newSite = ref('');
const notice = ref('');

onMounted(load);

async function load() {
  const [s, u, p, r] = await Promise.all([
    getSettings(),
    getUsage(),
    getPending(),
    getTollRecords(),
  ]);
  settings.value = JSON.parse(JSON.stringify(s));
  usage.value = u;
  pending.value = p;
  records.value = r.slice().reverse();
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const days = computed(() => {
  const list = recentDays(30);
  const max = Math.max(
    30 * 60,
    ...list.map((d) => usage.value[d]?.total ?? 0),
  );
  return list.map((d) => {
    const total = usage.value[d]?.total ?? 0;
    return {
      day: d,
      label: d.slice(5),
      minutes: Math.floor(total / 60),
      pct: (total / max) * 100,
    };
  });
});

const siteTotals = computed(() => {
  const acc: Record<string, { d7: number; d30: number }> = {};
  const d7 = new Set(recentDays(7));
  for (const day of recentDays(30)) {
    const perSite = usage.value[day]?.perSite ?? {};
    for (const [site, sec] of Object.entries(perSite)) {
      acc[site] ??= { d7: 0, d30: 0 };
      acc[site].d30 += sec;
      if (d7.has(day)) acc[site].d7 += sec;
    }
  }
  return Object.entries(acc)
    .map(([site, v]) => ({
      site,
      d7: Math.floor(v.d7 / 60),
      d30: Math.floor(v.d30 / 60),
    }))
    .sort((a, b) => b.d30 - a.d30);
});

function addSite() {
  const site = newSite.value.trim().replace(/^https?:\/\//, '').split('/')[0];
  if (site && !settings.value.sites.includes(site)) {
    settings.value.sites.push(site);
  }
  newSite.value = '';
}

function removeSite(site: string) {
  settings.value.sites = settings.value.sites.filter((s) => s !== site);
}

async function save() {
  const res = await browser.runtime.sendMessage({
    type: 'update-settings',
    settings: JSON.parse(JSON.stringify(settings.value)),
  });
  notice.value = res.pendingAt
    ? `收紧项已立即生效；放宽项将于 ${new Date(res.pendingAt).toLocaleString('zh-CN')} 生效（不对称生效规则）。`
    : '所有修改已立即生效。';
  await load();
}

async function exportJson() {
  const data = JSON.stringify(
    { usage: usage.value, settings: settings.value, tollRecords: records.value },
    null,
    2,
  );
  const url = URL.createObjectURL(
    new Blob([data], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = `attention-toll-export-${recentDays(1)[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div class="page">
    <h1>注意力关税 · 统计与设置</h1>

    <section>
      <h2>最近 30 个注意力日（凌晨 4 点为界）</h2>
      <div class="chart">
        <div
          v-for="d in days"
          :key="d.day"
          class="col"
          :title="`${d.day}：${d.minutes} 分钟`"
        >
          <div class="colbar" :style="{ height: Math.max(2, d.pct) + '%' }" />
        </div>
      </div>
      <div class="chart-labels">
        <span>{{ days[0]?.label }}</span>
        <span>{{ days[days.length - 1]?.label }}</span>
      </div>
    </section>

    <section>
      <h2>分站消耗</h2>
      <table v-if="siteTotals.length">
        <thead>
          <tr><th>网站</th><th>近 7 天</th><th>近 30 天</th></tr>
        </thead>
        <tbody>
          <tr v-for="row in siteTotals" :key="row.site">
            <td>{{ row.site }}</td>
            <td>{{ row.d7 }} 分钟</td>
            <td>{{ row.d30 }} 分钟</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted">暂无数据。</p>
      <button class="secondary" @click="exportJson">导出 JSON</button>
    </section>

    <section>
      <h2>通行记录</h2>
      <p class="muted">
        每次通过拦截页写下的话——继续时写的是关税，离开时写的是去向。
      </p>
      <table v-if="records.length">
        <thead>
          <tr><th>时间</th><th>网站</th><th>等级</th><th>去向</th><th>写下的话</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in records" :key="r.ts">
            <td class="nowrap">{{ fmtTime(r.ts) }}</td>
            <td>{{ r.site }}</td>
            <td>L{{ r.level }}</td>
            <td>
              <span :class="r.outcome === 'left' ? 'badge-left' : 'badge-stay'">
                {{ r.outcome === 'left' ? '离开' : '继续' }}
              </span>
            </td>
            <td>{{ r.text }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted">还没有通行记录。</p>
    </section>

    <section>
      <h2>设置</h2>
      <p class="muted">
        收紧（加网站、降阈值）立即生效；放宽（删网站、提阈值）次日凌晨 4 点生效——
        规则由冷静时的你制定，冲动时的你只能执行。
      </p>

      <h3>分心网站</h3>
      <ul class="sitelist">
        <li v-for="site in settings.sites" :key="site">
          {{ site }}
          <button class="link" @click="removeSite(site)">移除</button>
        </li>
      </ul>
      <div class="row">
        <input
          v-model="newSite"
          placeholder="如 weibo.com"
          @keyup.enter="addSite"
        />
        <button class="secondary" @click="addSite">添加</button>
      </div>

      <h3>干预阈值（分钟）</h3>
      <div class="thresholds">
        <label>L1 浮层提醒 <input type="number" min="1" v-model.number="settings.thresholds.l1" /></label>
        <label>L2 强制暂停 <input type="number" min="1" v-model.number="settings.thresholds.l2" /></label>
        <label>L3 承诺放行 <input type="number" min="1" v-model.number="settings.thresholds.l3" /></label>
        <label>L4 重度拦截 <input type="number" min="1" v-model.number="settings.thresholds.l4" /></label>
      </div>

      <button class="primary" @click="save">保存设置</button>
      <p v-if="notice" class="notice">{{ notice }}</p>
      <p v-if="pending" class="notice">
        ⏳ 有放宽修改待生效：{{ new Date(pending.applyAt).toLocaleString('zh-CN') }}
      </p>
    </section>
  </div>
</template>

<style scoped>
.page {
  max-width: 720px; margin: 0 auto; padding: 32px 20px;
  font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  color: #2c3e50;
}
h1 { font-size: 22px; }
h2 { font-size: 16px; margin: 0 0 12px; }
h3 { font-size: 14px; margin: 16px 0 8px; }
section { margin: 28px 0; padding: 20px; border: 1px solid #eee; border-radius: 12px; }
.chart { display: flex; align-items: flex-end; gap: 3px; height: 140px; }
.col { flex: 1; height: 100%; display: flex; align-items: flex-end; }
.colbar { width: 100%; background: #4a90d9; border-radius: 2px 2px 0 0; }
.chart-labels { display: flex; justify-content: space-between; font-size: 11px; color: #999; margin-top: 4px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 12px; }
th, td { text-align: left; padding: 7px 4px; border-bottom: 1px solid #f0f0f0; }
.muted { font-size: 12px; color: #999; line-height: 1.7; }
.sitelist { list-style: none; padding: 0; margin: 0 0 10px; }
.sitelist li {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 13px; padding: 6px 0; border-bottom: 1px solid #f0f0f0;
}
.row { display: flex; gap: 8px; }
input {
  padding: 8px 10px; border: 1px solid #ddd; border-radius: 8px;
  font-size: 13px; outline: none; flex: 1;
}
.thresholds { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.thresholds label { font-size: 13px; display: flex; align-items: center; gap: 8px; }
.thresholds input { width: 80px; flex: none; }
button { cursor: pointer; font-size: 13px; border-radius: 8px; }
.primary { margin-top: 16px; padding: 9px 20px; border: none; background: #2c3e50; color: #fff; }
.secondary { padding: 8px 16px; border: 1px solid #ddd; background: #fff; }
.link { border: none; background: none; color: #d9534f; font-size: 12px; }
.notice { font-size: 13px; color: #e6702c; margin-top: 10px; }
.nowrap { white-space: nowrap; }
.badge-stay, .badge-left {
  display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 12px;
}
.badge-stay { background: #fdecea; color: #d9534f; }
.badge-left { background: #eaf3fd; color: #4a90d9; }
</style>
