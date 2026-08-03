<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';
import { attentionDay } from '@/utils/day';
import { levelFor } from '@/utils/levels';
import { getSettings, getUsage } from '@/utils/storage';
import { mergedUsage } from '@/utils/sync';
import type { DayUsage, Thresholds } from '@/utils/types';

const today = ref<DayUsage>({ total: 0, perSite: {} });
const thresholds = ref<Thresholds>({ l1: 30, l2: 45, l3: 60, l4: 90 });

onMounted(async () => {
  const [settings, usage] = await Promise.all([getSettings(), getUsage()]);
  thresholds.value = settings.thresholds;
  const merged = await mergedUsage(usage);
  today.value = merged[attentionDay()] ?? { total: 0, perSite: {} };
});

const minutes = computed(() => Math.floor(today.value.total / 60));
const level = computed(() => levelFor(today.value.total, thresholds.value));
const levelText = ['专注中', '轻度提醒', '强制暂停', '承诺放行', '重度拦截'];
const nextThreshold = computed(() => {
  const t = thresholds.value;
  const m = minutes.value;
  for (const v of [t.l1, t.l2, t.l3, t.l4]) if (m < v) return v;
  return null;
});
const progress = computed(() =>
  Math.min(100, (minutes.value / thresholds.value.l4) * 100),
);
const sites = computed(() =>
  Object.entries(today.value.perSite).sort((a, b) => b[1] - a[1]),
);

function openDashboard() {
  browser.tabs.create({ url: browser.runtime.getURL('/dashboard.html') });
}
</script>

<template>
  <div class="popup">
    <h1>注意力关税</h1>
    <div class="big">{{ minutes }} <span>分钟</span></div>
    <div class="sub">
      当前等级 L{{ level }}（{{ levelText[level] }}）
      <template v-if="nextThreshold !== null">
        · 距下一级还有 {{ nextThreshold - minutes }} 分钟
      </template>
    </div>
    <div class="bar"><div class="fill" :style="{ width: progress + '%' }" /></div>
    <ul v-if="sites.length" class="sites">
      <li v-for="[site, seconds] in sites" :key="site">
        <span>{{ site }}</span>
        <b>{{ Math.floor(seconds / 60) }} 分钟</b>
      </li>
    </ul>
    <p v-else class="empty">今天还没有消耗注意力，很好。</p>
    <button @click="openDashboard">查看统计与设置</button>
  </div>
</template>

<style scoped>
.popup {
  width: 300px;
  padding: 16px;
  font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
}
h1 { font-size: 15px; margin: 0 0 12px; color: #2c3e50; }
.big { font-size: 40px; font-weight: 700; color: #2c3e50; }
.big span { font-size: 15px; font-weight: 400; color: #888; }
.sub { font-size: 12px; color: #888; margin: 4px 0 10px; }
.bar { height: 8px; border-radius: 4px; background: #eee; overflow: hidden; }
.fill { height: 100%; background: linear-gradient(90deg, #4a90d9, #e6a23c, #d9534f); }
.sites { list-style: none; padding: 0; margin: 14px 0; }
.sites li {
  display: flex; justify-content: space-between;
  font-size: 13px; padding: 5px 0; border-bottom: 1px solid #f0f0f0;
}
.empty { font-size: 13px; color: #4a90d9; }
button {
  width: 100%; padding: 9px; border: none; border-radius: 8px;
  background: #2c3e50; color: #fff; font-size: 13px; cursor: pointer;
}
</style>
