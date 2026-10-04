// 共通閲覧ランタイム（プレビュー・単独HTML・PWAで同一）。React非依存、DOM+CSSのみ。
// ユーザー文字列は必ずtextContentで表示する。
import { containBox, hotspotBox } from '../domain/rect';
import type { DemoDocument, DemoStep } from '../domain/types';

export interface ViewerOptions {
  doc: DemoDocument;
  imageUrl: (assetId: string) => string;
  /** 単独HTML/PWAではtrue。プレビューで外部ヘッダーを使う場合false */
  showHeader?: boolean;
  onChange?: (state: ViewerState) => void;
}

export interface ViewerState {
  stepId: string;
  history: string[];
  moves: number;
}

export interface ViewerHandle {
  goTo(stepId: string): void;
  back(): void;
  restart(): void;
  state(): ViewerState;
  relayout(): void;
  destroy(): void;
}

type Attrs = Record<string, string>;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string, attrs?: Attrs): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

let uid = 0;

export function mountViewer(root: HTMLElement, opts: ViewerOptions): ViewerHandle {
  const { doc } = opts;
  const id = `tv${++uid}`;
  const steps = new Map(doc.steps.map((s) => [s.id, s]));
  const assets = new Map(doc.assets.map((a) => [a.id, a]));
  const indexOf = (sid: string) => doc.steps.findIndex((s) => s.id === sid);
  const num = (sid: string) => String(indexOf(sid) + 1).padStart(2, '0');

  let history: string[] = [doc.startStepId];
  let moves = 0;

  root.replaceChildren();
  const wrap = el('div', 'tv-viewer');
  wrap.style.setProperty('--tv-accent', doc.theme.accentHex);

  const live = el('div', 'tv-visually-hidden', '', { 'aria-live': 'polite', role: 'status' });

  const header = el('header', 'tv-header');
  const headInner = el('div', 'tv-header-inner');
  const titleBox = el('div', 'tv-header-titles');
  if (doc.productLabel) titleBox.append(el('p', 'tv-product', doc.productLabel));
  titleBox.append(el('h1', 'tv-title', doc.title));
  const tocBtn = el('button', 'tv-btn tv-btn-secondary tv-toc-btn', '目次', { type: 'button', 'aria-expanded': 'false', 'aria-controls': `${id}-toc` });
  headInner.append(titleBox, tocBtn);
  header.append(headInner);

  const toc = el('nav', 'tv-toc', undefined, { id: `${id}-toc`, 'aria-label': '目次' });
  toc.hidden = true;
  const tocList = el('ol', 'tv-toc-list');
  for (const s of doc.steps) {
    const li = el('li');
    const b = el('button', 'tv-toc-item', `${num(s.id)}  ${s.title}`, { type: 'button' });
    b.addEventListener('click', () => {
      closeToc();
      goTo(s.id);
    });
    li.append(b);
    tocList.append(li);
  }
  toc.append(el('h2', 'tv-toc-title', '目次'), tocList);

  const main = el('main', 'tv-main');
  const stepTitle = el('h2', 'tv-step-title', '', { tabindex: '-1' });
  const stage = el('div', 'tv-stage');
  const img = el('img', 'tv-img', undefined, { decoding: 'async', draggable: 'false' });
  const layer = el('div', 'tv-hotspots');
  stage.append(img, layer);
  const desc = el('p', 'tv-desc');
  const actions = el('div', 'tv-actions');
  const note = el('p', 'tv-note', 'デモ内の操作です。実際の登録・送信・決済は行いません。');
  const trail = el('p', 'tv-trail');
  main.append(stepTitle, stage, desc, actions, note, trail);

  const bar = el('div', 'tv-bar');
  const barInner = el('div', 'tv-bar-inner');
  const backBtn = el('button', 'tv-btn tv-btn-secondary', '戻る', { type: 'button' });
  const restartBtn = el('button', 'tv-btn tv-btn-secondary', '最初から', { type: 'button' });
  barInner.append(backBtn, restartBtn);
  bar.append(barInner);

  if (opts.showHeader !== false) wrap.append(header);
  wrap.append(toc, main, bar, live);
  root.append(wrap);

  let hotspotEls: { btn: HTMLButtonElement; rect: DemoStep['hotspots'][number]['rect'] }[] = [];

  function layout() {
    const cur = steps.get(history[history.length - 1]!);
    const a = cur && assets.get(cur.assetId);
    if (!a) return;
    const box = containBox(stage.clientWidth, stage.clientHeight, a.width, a.height);
    for (const h of hotspotEls) {
      const r = hotspotBox(box, h.rect);
      h.btn.style.left = `${r.left}px`;
      h.btn.style.top = `${r.top}px`;
      h.btn.style.width = `${r.width}px`;
      h.btn.style.height = `${r.height}px`;
    }
  }

  function render(focus: boolean) {
    const cur = steps.get(history[history.length - 1]!);
    if (!cur) return;
    const a = assets.get(cur.assetId);
    stepTitle.textContent = `${num(cur.id)}  ${cur.title}`;
    if (a) {
      stage.style.aspectRatio = `${a.width} / ${a.height}`;
      img.src = opts.imageUrl(a.id);
      img.width = a.width;
      img.height = a.height;
    }
    img.alt = cur.altText;
    desc.textContent = cur.description;
    desc.hidden = !cur.description;
    const ordered = [...cur.hotspots].sort((x, y) => x.order - y.order);
    layer.replaceChildren();
    actions.replaceChildren();
    hotspotEls = [];
    for (const h of ordered) {
      const hb = el('button', 'tv-hotspot', undefined, { type: 'button', 'aria-label': h.label, 'data-hotspot': h.id });
      if (h.helpText) hb.title = h.helpText;
      hb.addEventListener('click', () => goTo(h.targetStepId));
      layer.append(hb);
      hotspotEls.push({ btn: hb, rect: h.rect });
      const item = el('div', 'tv-action');
      const ab = el('button', 'tv-btn tv-btn-primary tv-alt', h.label, { type: 'button', 'data-alt': h.id });
      ab.addEventListener('click', () => goTo(h.targetStepId));
      item.append(ab);
      if (h.helpText) item.append(el('p', 'tv-help', h.helpText));
      actions.append(item);
    }
    if (cur.kind === 'finish') {
      const item = el('div', 'tv-action tv-finish');
      item.append(el('p', 'tv-finish-text', 'デモはここで終わりです。最初からもう一度試せます。'));
      const rb = el('button', 'tv-btn tv-btn-primary tv-alt', '最初から', { type: 'button' });
      rb.addEventListener('click', restart);
      item.append(rb);
      actions.append(item);
    }
    backBtn.disabled = history.length <= 1;
    trail.textContent = `進んだ回数：${moves}　訪問：${history.map((sid) => steps.get(sid)?.title ?? '').join(' → ')}`;
    for (const b of tocList.querySelectorAll('button')) b.removeAttribute('aria-current');
    tocList.querySelectorAll('button')[indexOf(cur.id)]?.setAttribute('aria-current', 'step');
    layout();
    if (focus) {
      stepTitle.focus();
      live.textContent = `${cur.title}の画面を表示しました`;
    }
    opts.onChange?.(state());
  }

  function goTo(stepId: string) {
    if (!steps.has(stepId)) return;
    history = [...history, stepId];
    moves++;
    render(true);
  }
  function back() {
    if (history.length <= 1) return;
    history = history.slice(0, -1);
    render(true);
  }
  function restart() {
    history = [doc.startStepId];
    moves = 0;
    render(true);
  }
  function state(): ViewerState {
    return { stepId: history[history.length - 1]!, history: [...history], moves };
  }
  function closeToc() {
    toc.hidden = true;
    tocBtn.setAttribute('aria-expanded', 'false');
  }

  tocBtn.addEventListener('click', () => {
    const open = toc.hidden;
    toc.hidden = !open;
    tocBtn.setAttribute('aria-expanded', String(open));
    if (open) (tocList.querySelector('[aria-current]') as HTMLElement | null ?? tocList.querySelector('button'))?.focus();
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !toc.hidden) {
      closeToc();
      tocBtn.focus();
    }
  };
  wrap.addEventListener('keydown', onKey);
  backBtn.addEventListener('click', back);
  restartBtn.addEventListener('click', restart);

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => layout()) : null;
  ro?.observe(stage);
  const onResize = () => layout();
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  img.addEventListener('load', onResize);

  render(false);

  return {
    goTo,
    back,
    restart,
    state,
    relayout: layout,
    destroy() {
      ro?.disconnect();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      root.replaceChildren();
    },
  };
}
