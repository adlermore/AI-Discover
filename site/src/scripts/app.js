// Site-wide behaviour: theme, mentor mode, course progress, copy buttons,
// tooltips and table-of-contents highlighting. Everything degrades to a
// readable static page if storage or JS is unavailable.

const root = document.documentElement;
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
};

// ------------------------------------------------------------------ toast
const toastEl = document.querySelector('[data-toast]');
let toastTimer;
export function toast(message) {
  if (!toastEl) return;
  toastEl.querySelector('span').textContent = message;
  toastEl.dataset.show = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.dataset.show = 'false'), 1800);
}

// ------------------------------------------------------------------ theme
const prefersDark = matchMedia('(prefers-color-scheme: dark)');
const effectiveTheme = () => root.dataset.theme || (prefersDark.matches ? 'dark' : 'light');
$$('[data-theme-toggle]').forEach((btn) =>
  btn.addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('aid:theme', next); } catch {}
    document.dispatchEvent(new CustomEvent('themechange'));
  }),
);

// ------------------------------------------------------------------ mentor mode
const mentorBtns = $$('[data-mentor-toggle]');
const syncMentor = () => mentorBtns.forEach((b) => b.setAttribute('aria-pressed', String(root.dataset.mentor === 'on')));
syncMentor();
mentorBtns.forEach((btn) =>
  btn.addEventListener('click', () => {
    const on = root.dataset.mentor !== 'on';
    if (on) root.dataset.mentor = 'on';
    else delete root.dataset.mentor;
    try { localStorage.setItem('aid:mentor', on ? 'on' : 'off'); } catch {}
    syncMentor();
    toast(on ? 'Մենթորի ռեժիմը միացված է' : 'Մենթորի ռեժիմն անջատված է');
    document.dispatchEvent(new CustomEvent('mentorchange'));
  }),
);

// ------------------------------------------------------------------ mobile menu
const menuBtn = document.querySelector('[data-menu-toggle]');
const drawer = document.getElementById('drawer');
menuBtn?.addEventListener('click', () => {
  const open = drawer.dataset.open !== 'true';
  drawer.dataset.open = String(open);
  menuBtn.setAttribute('aria-expanded', String(open));
});

// ------------------------------------------------------------------ progress
const TOTAL = 24;
export const progress = {
  done: () => new Set(store.get('aid:done', [])),
  toggle(n) {
    const d = this.done();
    d.has(n) ? d.delete(n) : d.add(n);
    store.set('aid:done', [...d].sort((a, b) => a - b));
    renderProgress();
    return d.has(n);
  },
};

function renderProgress() {
  const done = progress.done();
  const count = done.size;
  $$('[data-session]').forEach((el) => el.classList.toggle('is-done', done.has(Number(el.dataset.session))));
  $$('[data-progress-count]').forEach((el) => (el.textContent = count));
  $$('[data-progress-bar]').forEach((el) => (el.style.width = `${(count / TOTAL) * 100}%`));
  // Rings are drawn with pathLength="100".
  $$('[data-progress-ring]').forEach((el) => (el.style.strokeDashoffset = `${100 - (count / TOTAL) * 100}`));
  const next = Array.from({ length: TOTAL }, (_, i) => i + 1).find((n) => !done.has(n));
  $$('[data-continue]').forEach((el) => {
    if (!next) { el.hidden = true; return; }
    el.href = `${el.dataset.continue}${next}/`;
    const label = el.querySelector('[data-continue-label]');
    if (label) label.textContent = count ? `Շարունակել՝ պարապմունք ${next}` : 'Սկսել պարապմունք 1-ից';
  });
  $$('[data-next-session]').forEach((el) => el.classList.toggle('is-next', Number(el.dataset.nextSession) === next));
  $$('[data-done-toggle]').forEach((btn) => {
    const on = done.has(Number(btn.dataset.doneToggle));
    btn.setAttribute('aria-pressed', String(on));
    const label = btn.querySelector('[data-label]');
    if (label) label.textContent = on ? 'Ավարտված է' : 'Նշել որպես ավարտված';
  });
}
renderProgress();
$$('[data-done-toggle]').forEach((btn) =>
  btn.addEventListener('click', () => {
    const on = progress.toggle(Number(btn.dataset.doneToggle));
    toast(on ? 'Պարապմունքը նշված է որպես ավարտված' : 'Նշումը հանված է');
  }),
);
window.addEventListener('storage', (e) => e.key === 'aid:done' && renderProgress());

// ------------------------------------------------------------------ copy prompts
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}
const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

$$('.doc .pr').forEach((pr) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'copy-btn';
  btn.dataset.copy = '';
  pr.append(btn);
});
$$('[data-copy]').forEach((btn) => {
  const idle = () => (btn.innerHTML = `${COPY_ICON}<span>Պատճենել</span>`);
  if (!btn.innerHTML.trim()) idle();
  btn.addEventListener('click', async () => {
    const box = btn.closest('.pr, [data-prompt]');
    const clone = box.querySelector('[data-prompt-text]')?.cloneNode(true) ?? box.cloneNode(true);
    clone.querySelectorAll('.t, .copy-btn').forEach((n) => n.remove());
    await copyText(clone.textContent.trim().replace(/\n{3,}/g, '\n\n'));
    btn.dataset.copied = 'true';
    btn.innerHTML = `${CHECK_ICON}<span>Պատճենված է</span>`;
    setTimeout(() => { btn.dataset.copied = 'false'; idle(); }, 1600);
  });
});

// ------------------------------------------------------------------ tooltip
const tip = document.querySelector('[data-tip-el]');
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
let tipTarget = null;
function showTip(el) {
  const { tipTitle, tipMeta, tip: body } = el.dataset;
  tip.innerHTML = `${tipMeta ? `<span class="t-meta">${esc(tipMeta)}</span>` : ''}${tipTitle ? `<b>${esc(tipTitle)}</b>` : ''}${body ? esc(body) : ''}`;
  tip.dataset.show = 'true';
  const r = el.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  let x = r.left + r.width / 2 - t.width / 2;
  let y = r.top - t.height - 10;
  if (y < 72) y = r.bottom + 10;
  x = Math.max(10, Math.min(x, innerWidth - t.width - 10));
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
  tipTarget = el;
}
const hideTip = () => { tip.dataset.show = 'false'; tipTarget = null; };
document.addEventListener('pointerover', (e) => {
  const el = e.target.closest?.('[data-tip], [data-tip-title]');
  if (el && el !== tipTarget) showTip(el);
  else if (!el && tipTarget) hideTip();
});
document.addEventListener('focusin', (e) => {
  const el = e.target.closest?.('[data-tip], [data-tip-title]');
  el ? showTip(el) : hideTip();
});
addEventListener('scroll', () => tipTarget && hideTip(), { passive: true });

// ------------------------------------------------------------------ toc scrollspy
const tocLinks = $$('.toc a[href^="#"]');
if (tocLinks.length) {
  const targets = tocLinks.map((a) => document.getElementById(decodeURIComponent(a.hash.slice(1)))).filter(Boolean);
  const update = () => {
    const y = scrollY + 140;
    let current = targets[0];
    for (const t of targets) if (t.offsetParent !== null && t.getBoundingClientRect().top + scrollY <= y) current = t;
    tocLinks.forEach((a) => a.setAttribute('aria-current', String(a.hash.slice(1) === current?.id)));
  };
  let raf;
  addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); }, { passive: true });
  update();
}
