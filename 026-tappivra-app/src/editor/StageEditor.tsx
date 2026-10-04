import { useEffect, useRef, useState } from 'react';
import { round6 } from '../domain/ids';
import { LIMITS } from '../domain/limits';
import { containBox, hotspotBox } from '../domain/rect';
import type { AssetMeta, Rect, Step, UUID } from '../domain/types';

export type Zoom = 'fit' | 25 | 50 | 75 | 100 | 150;
type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** ドラッグ結果の矩形（端からはみ出さない・最小1%） */
export function dragRect(start: Rect, mode: DragMode, dx: number, dy: number): Rect {
  const min = LIMITS.minHotspotSize;
  let { x, y, w, h } = start;
  if (mode === 'move') {
    x = clamp(x + dx, 0, 1 - w);
    y = clamp(y + dy, 0, 1 - h);
  } else {
    let x1 = x + w;
    let y1 = y + h;
    if (mode === 'nw' || mode === 'sw') x = clamp(x + dx, 0, x1 - min);
    if (mode === 'ne' || mode === 'se') x1 = clamp(x1 + dx, x + min, 1);
    if (mode === 'nw' || mode === 'ne') y = clamp(y + dy, 0, y1 - min);
    if (mode === 'sw' || mode === 'se') y1 = clamp(y1 + dy, y + min, 1);
    w = x1 - x;
    h = y1 - y;
  }
  return { x: round6(x), y: round6(y), w: round6(w), h: round6(h) };
}

export function StageEditor(props: {
  step: Step;
  asset: AssetMeta | undefined;
  url: string | undefined;
  zoom: Zoom;
  selectedHotspotId: UUID | null;
  overlapping: Set<UUID>;
  onSelect: (id: UUID | null) => void;
  onCommitRect: (id: UUID, rect: Rect) => void;
  onNudge: (id: UUID, dx: number, dy: number) => void;
}) {
  const { step, asset, zoom } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [temp, setTemp] = useState<{ id: UUID; rect: Rect } | null>(null);
  const drag = useRef<{ id: UUID; mode: DragMode; start: Rect; px: number; py: number; moved: boolean } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!asset) return <div className="stage-wrap" ref={wrapRef}><p style={{ padding: 24 }}>画像を読み込み中…</p></div>;

  const natural = zoom === 'fit' ? null : { w: (asset.width * zoom) / 100, h: (asset.height * zoom) / 100 };
  const cw = natural ? natural.w : size.w;
  const ch = natural ? natural.h : size.h;
  const box = containBox(cw, ch, asset.width, asset.height);

  const onPointerDown = (e: React.PointerEvent, id: UUID, mode: DragMode, rect: Rect) => {
    e.stopPropagation();
    props.onSelect(id);
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = { id, mode, start: rect, px: e.clientX, py: e.clientY, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || box.width === 0) return;
    const dx = (e.clientX - d.px) / box.width;
    const dy = (e.clientY - d.py) / box.height;
    if (Math.abs(e.clientX - d.px) + Math.abs(e.clientY - d.py) > 2) d.moved = true;
    setTemp({ id: d.id, rect: dragRect(d.start, d.mode, dx, dy) });
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved && temp && temp.id === d.id) props.onCommitRect(d.id, temp.rect);
    setTemp(null);
  };

  return (
    <div className="stage-wrap" ref={wrapRef} onPointerDown={() => props.onSelect(null)} data-testid="editor-stage">
      <div
        className={natural ? 'stage' : 'stage-fit'}
        style={natural ? { width: natural.w, height: natural.h } : undefined}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {props.url && (
          <img className="stage-img" src={props.url} alt={step.altText} style={{ left: box.left, top: box.top, width: box.width, height: box.height }} draggable={false} />
        )}
        {[...step.hotspots]
          .sort((a, b) => a.order - b.order)
          .map((h) => {
            const rect = temp?.id === h.id ? temp.rect : h.rect;
            const b = hotspotBox(box, rect);
            const selected = props.selectedHotspotId === h.id;
            return (
              <div
                key={h.id}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                aria-label={`クリック箇所「${h.label}」。矢印キーで0.5%、Shift+矢印で2%移動`}
                data-hotspot-id={h.id}
                className={`hs${props.overlapping.has(h.id) ? ' warn' : ''}`}
                style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
                onPointerDown={(e) => onPointerDown(e, h.id, 'move', h.rect)}
                onFocus={() => props.selectedHotspotId !== h.id && props.onSelect(h.id)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  const step = e.shiftKey ? 0.02 : 0.005;
                  const map: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
                  const m = map[e.key];
                  if (m) {
                    e.preventDefault();
                    props.onNudge(h.id, m[0], m[1]);
                  }
                }}
              >
                <span className="hs-label">{h.label}</span>
                {selected &&
                  (['nw', 'ne', 'sw', 'se'] as const).map((c) => (
                    <span key={c} className={`hs-handle ${c}`} onPointerDown={(e) => onPointerDown(e, h.id, c, h.rect)} aria-hidden="true" />
                  ))}
              </div>
            );
          })}
      </div>
    </div>
  );
}
