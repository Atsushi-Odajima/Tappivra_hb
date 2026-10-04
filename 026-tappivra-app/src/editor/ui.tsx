import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export function Modal(props: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; closeLabel?: string; headExtra?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const { onClose } = props;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus], input, select, textarea, button');
    first?.focus();
    return () => prev?.focus?.();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing) {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select, textarea, [tabindex="0"], a[href]')];
        if (f.length === 0) return;
        const first = f[0]!;
        const last = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="modal-backdrop">
      <div className={`modal${props.wide ? ' modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="modal-head">
          <h2 id={titleId} className="h-panel">
            {props.title}
          </h2>
          {props.headExtra}
          <button type="button" className="btn btn-secondary btn-small" onClick={props.onClose}>
            {props.closeLabel ?? '閉じる'}
          </button>
        </div>
        <div className="modal-body">{props.children}</div>
        {props.footer && <div className="modal-foot">{props.footer}</div>}
      </div>
    </div>
  );
}

/** 入力中はローカル状態、確定（blur/Enter）時にcommit。IME変換中のEnterでは確定しない。 */
export function TextField(props: {
  label: string;
  value: string;
  onCommit: (v: string) => string | void;
  multiline?: boolean;
  maxLength?: number;
  required?: boolean;
  hint?: string;
  error?: string;
  inputRef?: React.Ref<HTMLInputElement & HTMLTextAreaElement>;
  name?: string;
}) {
  const id = useId();
  const [v, setV] = useState(props.value);
  const [localErr, setLocalErr] = useState<string | undefined>();
  useEffect(() => setV(props.value), [props.value]);
  const commit = () => {
    if (v === props.value) return;
    if (props.required && !v.trim()) {
      setLocalErr(`${props.label}を入力してください`);
      return;
    }
    const r = props.onCommit(v);
    setLocalErr(typeof r === 'string' ? r : undefined);
  };
  const err = localErr ?? props.error;
  const describedBy = [err ? `${id}-err` : '', props.hint ? `${id}-hint` : ''].filter(Boolean).join(' ') || undefined;
  const common = {
    id,
    name: props.name,
    value: v,
    maxLength: props.maxLength,
    'aria-invalid': err ? true : undefined,
    'aria-describedby': describedBy,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV(e.target.value),
    onBlur: commit,
    ref: props.inputRef,
  };
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      {props.multiline ? (
        <textarea className="textarea" {...common} />
      ) : (
        <input
          className="input"
          {...common}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit();
          }}
        />
      )}
      {props.hint && (
        <p id={`${id}-hint`} className="field-hint">
          {props.hint}
        </p>
      )}
      {err && (
        <p id={`${id}-err`} className="field-error" role="alert">
          {err}
        </p>
      )}
    </div>
  );
}

export function useObjectUrl(bytes: Uint8Array | undefined, mime: string): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!bytes) return setUrl(undefined);
    const u = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [bytes, mime]);
  return url;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 / 1024).toFixed(1)} MiB`;
}

export function formatDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export const LOGO_SRC = '/brand/logo_horizontal.svg';
