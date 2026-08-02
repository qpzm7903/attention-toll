# 注意力关税 Attention Toll

Chrome 插件：监控你在分心网站（bilibili、知乎……）上消耗的注意力时间，用**递增摩擦**让「继续娱乐」成为一个有代价的显式选择——不禁止通行，但每次通行都要付出代价。

## 核心机制

- **注意力时间**：前台聚焦计时；后台播放音视频也计时；空闲 60 秒停表
- **全局共享池**：所有分心网站共用一个每日额度，杜绝「换个网站接着刷」
- **注意力日**：凌晨 4 点重置，熬夜消耗计入前一天
- **干预阶梯**（默认 30/45/60/90 分钟触发）：
  - L1 浮层提醒（损失框架：换算成 25 分钟专注块）
  - L2 强制等待 10 秒 + 回答「你原本打算做什么？」→ 放行 15 分钟
  - L3 等待 20 秒 + 逐字输入承诺语句 → 放行 10 分钟
  - L4 等待 30 秒 + 输入承诺语句 → 仅放行 5 分钟
- **永不硬封锁**（ADR-0001）、**设置不对称生效**（ADR-0002）：收紧立即生效，放宽次日 4 点生效

领域术语见 [CONTEXT.md](./CONTEXT.md)，关键决策见 [docs/adr/](./docs/adr/)。

## 开发

```bash
npm install
npm run dev      # 开发模式（自动打开 Chrome 并热重载）
npm run build    # 产出 .output/chrome-mv3/
npm run compile  # 类型检查
```

## 手动安装

1. `npm run build`
2. 打开 `chrome://extensions`，开启「开发者模式」
3. 「加载已解压的扩展程序」→ 选择 `.output/chrome-mv3/` 目录

## 技术栈

WXT + TypeScript + Vue 3，Manifest V3（ADR-0003）。数据全部存于本地 `chrome.storage.local`，统计页支持 JSON 导出。

## License

[MIT](./LICENSE)
