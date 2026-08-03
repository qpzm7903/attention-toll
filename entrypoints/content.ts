import { COMMITMENT_PHRASE, GRACE_MINUTES, WAIT_SECONDS } from '@/utils/levels';
import type { SiteState, TollRecord } from '@/utils/types';

const POLL_MS = 5000;

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
.backdrop {
  position: fixed; inset: 0; z-index: 2147483647;
  display: flex; align-items: flex-start; justify-content: center;
  background: rgba(12, 16, 24, .45);
}
.notice {
  margin-top: 10vh; max-width: 480px; width: 92%;
  background: #2c3e50; color: #fff; padding: 24px 28px; border-radius: 14px;
  box-shadow: 0 12px 48px rgba(0,0,0,.45); font-size: 15px; line-height: 1.8;
}
.notice h1 { font-size: 18px; margin: 0 0 10px; color: #fff; }
.notice .bar { height: 8px; border-radius: 4px; background: rgba(255,255,255,.15); overflow: hidden; margin: 12px 0; }
.notice .fill { height: 100%; background: linear-gradient(90deg, #4a90d9, #e6a23c, #d9534f); }
.notice button {
  margin-top: 12px; padding: 8px 18px; border: none; border-radius: 8px;
  background: #e6a23c; color: #fff; cursor: pointer; font-size: 14px;
}
.overlay {
  position: fixed; inset: 0; z-index: 2147483647;
  background: rgba(12, 16, 24, .96); color: #eee;
  display: flex; align-items: center; justify-content: center;
}
.card { max-width: 480px; width: 90%; text-align: center; padding: 24px; }
.card h1 { font-size: 22px; margin: 0 0 12px; color: #fff; }
.card p { font-size: 15px; line-height: 1.8; color: #bbb; margin: 8px 0; }
.card .stat { font-size: 15px; color: #e6a23c; }
.echo {
  font-size: 14px; line-height: 1.7; color: #9fc3ee; background: #16202e;
  border-left: 3px solid #4a90d9; border-radius: 6px; padding: 10px 14px;
  margin: 14px 0; text-align: left;
}
.echo b { color: #fff; }
.countdown { font-size: 44px; font-weight: 700; color: #e6a23c; margin: 18px 0; }
.card textarea, .card input[type=text] {
  width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid #445;
  background: #1a2230; color: #fff; font-size: 14px; margin: 12px 0; outline: none;
}
.phrase { font-size: 15px; color: #fff; background: #1a2230; border-radius: 8px; padding: 10px; margin: 12px 0; user-select: none; }
.actions { display: flex; gap: 12px; justify-content: center; margin-top: 16px; }
.btn-continue {
  padding: 10px 22px; border: none; border-radius: 8px; font-size: 14px; cursor: pointer;
  background: #d9534f; color: #fff;
}
.btn-continue:disabled { background: #555; cursor: not-allowed; }
.btn-leave {
  padding: 10px 22px; border: 1px solid #4a90d9; border-radius: 8px; font-size: 14px;
  cursor: pointer; background: transparent; color: #4a90d9;
}
.btn-leave.primary { background: #4a90d9; color: #fff; }
.btn-leave:disabled { border-color: #555; color: #777; background: transparent; cursor: not-allowed; }
.btn-back { border: none; background: none; color: #888; font-size: 13px; cursor: pointer; margin-top: 14px; }
`;

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  main() {
    let host: HTMLElement | null = null;
    let shadow: ShadowRoot | null = null;
    let rendered: 'none' | 'toast' | number = 'none';

    function ensureRoot(): ShadowRoot {
      if (shadow) return shadow;
      host = document.createElement('attention-toll-root');
      shadow = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = CSS;
      shadow.appendChild(style);
      document.documentElement.appendChild(host);
      return shadow;
    }

    function clearUi() {
      host?.remove();
      host = null;
      shadow = null;
      rendered = 'none';
    }

    const fmtMinutes = (s: number) => Math.floor(s / 60);
    /** 损失框架：把消耗换算成 25 分钟专注块 */
    const focusBlocks = (s: number) => (s / 60 / 25).toFixed(1);

    const escapeHtml = (s: string) =>
      s.replace(
        /[&<>"']/g,
        (c) =>
          ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
            c
          ]!,
      );

    /** 自我对质回显：「你 N 分钟前写下：……」 */
    function echoHtml(record: TollRecord | null): string {
      if (!record) return '';
      const minutesAgo = Math.max(1, Math.round((Date.now() - record.ts) / 60_000));
      const ago =
        minutesAgo >= 60
          ? `${Math.floor(minutesAgo / 60)} 小时 ${minutesAgo % 60} 分钟前`
          : `${minutesAgo} 分钟前`;
      const verb = record.outcome === 'left' ? '离开时写下' : '继续访问时写下';
      return `<div class="echo">你 <b>${ago}</b>${verb}：<b>“${escapeHtml(record.text)}”</b>${
        record.outcome === 'left' ? '<br/>现在，你又回来了。' : ''
      }</div>`;
    }

    async function poll() {
      let state: SiteState | undefined;
      try {
        state = await browser.runtime.sendMessage({ type: 'get-state' });
      } catch {
        return; // 后台暂不可用（扩展刚更新等），下次再试
      }
      if (!state?.tracked) {
        clearUi();
        return;
      }
      if (state.blocked) {
        if (rendered !== state.level) renderOverlay(state);
      } else if (state.showToast) {
        if (rendered !== 'toast') renderNotice(state);
      } else {
        clearUi();
      }
    }

    /** L1：居中大卡片 + 进度条 + 背景压暗，一键关闭，不强制书写 */
    function renderNotice(state: SiteState) {
      clearUi();
      rendered = 'toast';
      const root = ensureRoot();
      const pct = Math.min(
        100,
        (state.todaySeconds / 60 / state.thresholds.l4) * 100,
      );
      const backdrop = document.createElement('div');
      backdrop.className = 'backdrop';
      backdrop.innerHTML = `
        <div class="notice">
          <h1>⏳ 注意力关税提醒</h1>
          <div>今日已在分心网站消耗 <b>${fmtMinutes(state.todaySeconds)} 分钟</b>——
          相当于 <b>${focusBlocks(state.todaySeconds)} 个</b>深度专注块（25 分钟/个）。</div>
          <div class="bar"><div class="fill" style="width:${pct}%"></div></div>
          <div>再过 ${Math.max(0, state.thresholds.l2 - fmtMinutes(state.todaySeconds))} 分钟将进入强制暂停。</div>
          <button>我知道了</button>
        </div>
      `;
      backdrop.querySelector('button')!.addEventListener('click', async () => {
        await browser.runtime.sendMessage({ type: 'acknowledge', level: 1 });
        clearUi();
      });
      root.appendChild(backdrop);
    }

    function renderOverlay(state: SiteState) {
      clearUi();
      rendered = state.level;
      const root = ensureRoot();
      const level = state.level;
      const wait = WAIT_SECONDS[level] ?? 10;
      const grace = GRACE_MINUTES[level] ?? 0;
      const needPhrase = level >= 3;

      const overlay = document.createElement('div');
      overlay.className = 'overlay';
      const card = document.createElement('div');
      card.className = 'card';
      overlay.appendChild(card);
      root.appendChild(overlay);

      const header = `
        <h1>${level >= 4 ? '你已经在这里很久了' : '停一下'}</h1>
        <p class="stat">今日已消耗 ${fmtMinutes(state.todaySeconds)} 分钟注意力，
        相当于 ${focusBlocks(state.todaySeconds)} 个深度专注块。</p>
        ${echoHtml(state.lastRecord)}
      `;

      /** 主视图：倒计时 + 继续路径书写；离开按钮切换到离开书写视图 */
      function renderMain() {
        card.innerHTML = `
          ${header}
          <div class="countdown">${wait}</div>
          ${
            needPhrase
              ? `<p>继续访问需要输入下面这句话（放行 ${grace} 分钟）：</p>
                 <div class="phrase">${COMMITMENT_PHRASE}</div>
                 <input type="text" placeholder="逐字输入上面的句子" disabled />`
              : `<p>你原本打算做什么？写下来再决定要不要继续（放行 ${grace} 分钟）：</p>
                 <textarea rows="2" placeholder="例如：查一个技术方案 / 就是想放松一下" disabled></textarea>`
          }
          <div class="actions">
            <button class="btn-continue" disabled>付出代价，继续访问</button>
            <button class="btn-leave">回到正事</button>
          </div>
        `;
        const countdownEl = card.querySelector('.countdown') as HTMLElement;
        const input = card.querySelector('input, textarea') as
          | HTMLInputElement
          | HTMLTextAreaElement;
        const btnContinue = card.querySelector(
          '.btn-continue',
        ) as HTMLButtonElement;
        const btnLeave = card.querySelector('.btn-leave') as HTMLButtonElement;

        // 强制等待：倒计时只作用于「继续」路径；离开随时可选（但也要书写）
        let remaining = wait;
        const timer = setInterval(() => {
          remaining -= 1;
          countdownEl.textContent = String(remaining);
          if (remaining <= 0) {
            clearInterval(timer);
            countdownEl.textContent = '·';
            input.disabled = false;
            input.focus();
            validate();
          }
        }, 1000);

        const validate = () => {
          const v = input.value.trim();
          btnContinue.disabled =
            remaining > 0 || (needPhrase ? v !== COMMITMENT_PHRASE : v.length < 2);
        };
        input.addEventListener('input', validate);
        input.addEventListener('paste', (e) => e.preventDefault());

        btnContinue.addEventListener('click', async () => {
          await browser.runtime.sendMessage({
            type: 'acknowledge',
            level,
            outcome: 'continued',
            site: state.site,
            text: input.value.trim(),
          });
          clearUi();
        });
        btnLeave.addEventListener('click', () => {
          clearInterval(timer);
          renderLeave();
        });
      }

      /** 离开视图：必须写下「接下来去做什么」才能关闭页面（执行意图） */
      function renderLeave() {
        card.innerHTML = `
          ${header}
          <p>好选择。写下你接下来要去做的事，然后离开：</p>
          <textarea rows="2" placeholder="我接下来要去……（例如：写完 attention-toll 的统计页）"></textarea>
          <div class="actions">
            <button class="btn-leave primary" disabled>写完了，离开</button>
          </div>
          <button class="btn-back">← 返回</button>
        `;
        const input = card.querySelector('textarea') as HTMLTextAreaElement;
        const btnGo = card.querySelector('.btn-leave') as HTMLButtonElement;
        const btnBack = card.querySelector('.btn-back') as HTMLButtonElement;

        input.focus();
        input.addEventListener('input', () => {
          btnGo.disabled = input.value.trim().length < 2;
        });
        input.addEventListener('paste', (e) => e.preventDefault());

        btnGo.addEventListener('click', async () => {
          await browser.runtime.sendMessage({
            type: 'acknowledge',
            level,
            outcome: 'left',
            site: state.site,
            text: input.value.trim(),
          });
          window.location.href = 'about:blank';
          window.close();
        });
        btnBack.addEventListener('click', () => renderMain());
      }

      renderMain();
    }

    poll();
    setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) poll();
    });
  },
});
