// Page-by-page PDF viewer built on pdf.js. Pages render lazily near the
// viewport and are released again when far away, so 70-page documents stay light.
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.85, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.5, 3];
const MAX_FIT = 1.35;
const THUMB_W = 136;

const root = document.querySelector('[data-viewer]');
if (root) init(root);

async function init(root) {
  const pagesEl = root.querySelector('[data-pages-el]');
  const thumbsEl = root.querySelector('[data-thumbs]');
  const status = root.querySelector('[data-status]');
  const statusText = root.querySelector('[data-status-text]');
  const input = root.querySelector('[data-page-input]');
  const zoomVal = root.querySelector('[data-zoom-fit]');
  const bar = root.querySelector('.vbar');
  const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

  const task = pdfjs.getDocument({ url: root.dataset.src, isEvalSupported: false });
  task.onProgress = ({ loaded, total }) => {
    if (total) statusText.textContent = `Բեռնվում է… ${Math.min(100, Math.round((loaded / total) * 100))}%`;
  };

  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    console.error(err);
    status.classList.add('error');
    statusText.innerHTML = `Չհաջողվեց բացել PDF-ը այս դիտարկիչում։ <a href="${root.dataset.src}" download>Ներբեռնել ֆայլը</a>`;
    return;
  }
  const base = (await doc.getPage(1)).getViewport({ scale: 1 });
  status.remove();

  // ------------------------------------------------------------ page shells
  const shells = [];
  const thumbs = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const shell = document.createElement('div');
    shell.className = 'vpage-shell';
    shell.id = `page-${n}`;
    shell.dataset.page = n;
    shell.innerHTML = `<canvas></canvas><span class="vpage-num">${n}</span>`;
    pagesEl.append(shell);
    shells.push(shell);

    const th = document.createElement('button');
    th.type = 'button';
    th.className = 'vthumb';
    th.dataset.page = n;
    th.setAttribute('aria-label', `Էջ ${n}`);
    th.innerHTML = `<span class="tcanvas" style="aspect-ratio:${base.width}/${base.height}"></span><span>${n}</span>`;
    th.addEventListener('click', () => goTo(n));
    thumbsEl.append(th);
    thumbs.push(th);
  }

  // ------------------------------------------------------------ zoom & layout
  let zoom = null; // null = fit to width
  const fitScale = () => Math.min(MAX_FIT, (pagesEl.clientWidth - 32) / base.width);
  const scale = () => zoom ?? fitScale();

  function layout() {
    const s = scale();
    const w = Math.round(base.width * s);
    const h = Math.round(base.height * s);
    for (const sh of shells) {
      sh.style.width = `${w}px`;
      sh.style.height = `${h}px`;
      sh.style.aspectRatio = `${base.width} / ${base.height}`;
    }
    zoomVal.textContent = `${Math.round(s * 100)}%`;
    zoomVal.setAttribute('aria-pressed', String(zoom === null));
    near.forEach(render);
  }

  // ------------------------------------------------------------ rendering
  const tasks = new Map();
  async function render(shell) {
    const key = `${scale().toFixed(3)}@${dpr()}`;
    if (shell.dataset.rendered === key) return;
    tasks.get(shell)?.cancel();
    const page = await doc.getPage(Number(shell.dataset.page));
    const vp = page.getViewport({ scale: scale() * dpr() });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    const t = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
    tasks.set(shell, t);
    try {
      await t.promise;
    } catch {
      return; // cancelled by a newer render
    }
    tasks.delete(shell);
    if (!near.has(shell)) return;
    shell.querySelector('canvas').replaceWith(canvas);
    shell.dataset.rendered = key;
  }
  function release(shell) {
    tasks.get(shell)?.cancel();
    tasks.delete(shell);
    if (!shell.dataset.rendered) return;
    shell.querySelector('canvas').replaceWith(document.createElement('canvas'));
    delete shell.dataset.rendered;
  }

  const near = new Set();
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { near.add(e.target); render(e.target); }
        else { near.delete(e.target); release(e.target); }
      }
    },
    { rootMargin: '1200px 0px' },
  );
  shells.forEach((s) => io.observe(s));

  const thumbIo = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting || e.target.dataset.done) continue;
        e.target.dataset.done = '1';
        renderThumb(e.target);
      }
    },
    { root: thumbsEl, rootMargin: '400px 0px' },
  );
  thumbs.forEach((t) => thumbIo.observe(t));
  async function renderThumb(th) {
    const page = await doc.getPage(Number(th.dataset.page));
    const vp = page.getViewport({ scale: (THUMB_W / base.width) * dpr() });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    th.querySelector('.tcanvas').append(canvas);
  }

  // ------------------------------------------------------------ navigation
  const offsetTop = () => (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 64) + bar.offsetHeight + 16;
  function goTo(n, smooth = true) {
    const shell = shells[Math.max(1, Math.min(doc.numPages, n)) - 1];
    const delta = shell.getBoundingClientRect().top - offsetTop();
    // Far jumps are instant: animating past dozens of pages would render them all on the way.
    const behavior = smooth && Math.abs(delta) < innerHeight * 2.5 ? 'smooth' : 'auto';
    window.scrollTo({ top: scrollY + delta, behavior });
  }
  let current = 1;
  function trackCurrent() {
    const line = offsetTop() + innerHeight * 0.25;
    let n = 1;
    for (const sh of shells) {
      if (sh.getBoundingClientRect().top <= line) n = Number(sh.dataset.page);
      else break;
    }
    if (n === current) return;
    current = n;
    if (document.activeElement !== input) input.value = n;
    thumbs.forEach((t) => t.setAttribute('aria-current', String(Number(t.dataset.page) === n)));
    const th = thumbs[n - 1];
    const tr = th.getBoundingClientRect();
    const cr = thumbsEl.getBoundingClientRect();
    if (tr.top < cr.top || tr.bottom > cr.bottom) thumbsEl.scrollTo({ top: th.offsetTop - thumbsEl.clientHeight / 3, behavior: 'smooth' });
  }
  let raf;
  addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(trackCurrent); }, { passive: true });
  thumbs[0].setAttribute('aria-current', 'true');

  input.addEventListener('change', () => goTo(Number(input.value) || 1));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); goTo(Number(input.value) || 1); input.blur(); } });

  function setZoom(z) {
    const page = current;
    zoom = z;
    layout();
    goTo(page, false);
  }
  root.querySelectorAll('[data-zoom]').forEach((b) =>
    b.addEventListener('click', () => {
      const s = scale();
      const dir = Number(b.dataset.zoom);
      const nextZ = dir > 0 ? ZOOM_STEPS.find((z) => z > s + 0.01) : [...ZOOM_STEPS].reverse().find((z) => z < s - 0.01);
      if (nextZ) setZoom(nextZ);
    }),
  );
  zoomVal.addEventListener('click', () => setZoom(null));

  addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(current + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(current - 1); }
  });

  let resizeTimer;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => zoom === null && layout(), 120);
  }).observe(pagesEl);

  layout();
  const fromHash = Number((location.hash.match(/^#page-(\d+)$/) || [])[1]);
  if (fromHash) goTo(fromHash, false);
}
