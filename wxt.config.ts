import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: '注意力关税 Attention Toll',
    description:
      '监控分心网站的注意力消耗，用递增摩擦让「继续娱乐」成为有代价的显式选择。',
    permissions: ['storage', 'tabs', 'alarms', 'idle'],
  },
});
