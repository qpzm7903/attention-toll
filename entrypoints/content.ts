import { COMMITMENT_PHRASE, GRACE_MINUTES, WAIT_SECONDS } from '@/utils/levels';
import type { SiteState } from '@/utils/types';

const POLL_MS = 5000;

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
.toast {
  position: fixed; top: 20px; right: 20px; z-index: 2147483647;
  background: #2c3e50; color: #fff; padding: 16px 20px; border-radius: 10px;
  max-width: 340px; box-shadow: 0 8px 30px rgba(0,0,0,.35); font-size: 14px; line-height: 1.6;
}
.toast button {
  margin-top: 10px; padding: 6px 14px; border: none; border-radius: 6px;
  background: #e6a23c; color: #fff; cursor: pointer; font-size: 13px;
}
.overlay {
  position: fixed; inset: 0; z-index: 2147483647;
  background: rgba(12, 16, 24, .96); color: #eee;
  display: flex; align-items: center; justify-content: center;
}
.card { max-width: 460px; width: 90%; text-align: center; padding: 24px; }
.card h1 { font-size: 22px; margin: 0 0 12px; color: #fff; }
.card p { font-size: 15px; line-height: 1.8; color: #bbb; margin: 8px 0; }
.card .stat { font-size: 15px; color: #e6a23c; }
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
        if (rendered !== 'toast') renderToast(state);
      } else {
        clearUi();
      }
    }

    function renderToast(state: SiteState) {
      clearUi();
      rendered = 'toast';
      const root = ensureRoot();
      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.innerHTML = `
        <div>⏳ 今日已在分心网站消耗 <b>${fmtMinutes(state.todaySeconds)} 分钟</b>——
        相当于 <b>${focusBlocks(state.todaySeconds)} 个</b>深度专注块（25 分钟/个）。</div>
        <button>我知道了</button>
      `;
      toast.querySelector('button')!.addEventListener('click', async () => {
        await browser.runtime.sendMessage({ type: 'acknowledge', level: 1 });
        clearUi();
      });
      root.appendChild(toast);
    }

    function renderOverlay(state: SiteState) {
      clearUi();
      rendered = state.level;
      const root = ensureRoot();
      const level = state.level;
      const wait = WAIT_SECONDS[level] ?? 10;
      const grace = GRACE_MINUTES[level] ?? 0;

      const overlay = document.createElement('div');
      overlay.className = 'overlay';
      const card = document.createElement('div');
      card.className = 'card';

      const needPhrase = level >= 3;
      card.innerHTML = `
        <h1>${level >= 4 ? '你已经在这里很久了' : '停一下'}</h1>
        <p class="stat">今日已消耗 ${fmtMinutes(state.todaySeconds)} 分钟注意力，
        相当于 ${focusBlocks(state.todaySeconds)} 个深度专注块。</p>
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
      overlay.appendChild(card);
      root.appendChild(overlay);

      const countdownEl = card.querySelector('.countdown') as HTMLElement;
      const input = card.querySelector('input, textarea') as
        | HTMLInputElement
        | HTMLTextAreaElement;
      const btnContinue = card.querySelector(
        '.btn-continue',
      ) as HTMLButtonElement;
      const btnLeave = card.querySelector('.btn-leave') as HTMLButtonElement;

      // 强制等待：倒计时结束前输入框和按钮都不可用（20 秒法则）
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
        btnContinue.disabled = remaining > 0 || (needPhrase ? v !== COMMITMENT_PHRASE : v.length < 2);
      };
      input.addEventListener('input', validate);
      input.addEventListener('paste', (e) => e.preventDefault());

      btnContinue.addEventListener('click', async () => {
        await browser.runtime.sendMessage({
          type: 'acknowledge',
          level,
          intent: needPhrase ? undefined : input.value.trim(),
        });
        clearUi();
      });
      btnLeave.addEventListener('click', () => {
        window.location.href = 'about:blank';
        window.close();
      });
    }

    poll();
    setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) poll();
    });
  },
});
