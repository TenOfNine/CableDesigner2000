import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// ---------- Modal ----------
export function Modal({ title, onClose, children, footer, wide, className = '' }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''} ${className}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3 className="grow">{title}</h3>
          {onClose && (
            <button className="ghost icon small" onClick={onClose} aria-label="Schließen">
              ✕
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

// ---------- Kontextmenü ----------
// items: [{ label, icon, onClick, danger, disabled, checked, items: [...] } | { separator: true } | { title }]
export function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.min(x, window.innerWidth - r.width - 8),
      y: Math.min(y, window.innerHeight - r.height - 8),
    });
  }, [x, y]);
  useEffect(() => {
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);
  return createPortal(
    <div ref={ref} className="ctx-menu" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      <MenuItems items={items} onClose={onClose} />
    </div>,
    document.body
  );
}

function MenuItems({ items, onClose }) {
  const [open, setOpen] = useState(null);
  return items.filter(Boolean).map((it, i) => {
    if (it.separator) return <div key={i} className="ctx-sep" />;
    if (it.title) return <div key={i} className="ctx-title">{it.title}</div>;
    const hasSub = Array.isArray(it.items);
    return (
      <div
        key={i}
        className={`ctx-item ${it.danger ? 'danger' : ''} ${it.disabled ? 'disabled' : ''} ${open === i ? 'open' : ''}`}
        onMouseEnter={() => setOpen(hasSub ? i : null)}
        onClick={(e) => {
          e.stopPropagation();
          if (hasSub) return setOpen(i);
          it.onClick?.();
          onClose();
        }}
      >
        <span className="ctx-icon">{it.icon || ''}</span>
        <span>{it.label}</span>
        {hasSub && <span className="ctx-arrow">›</span>}
        {it.checked && <span className="ctx-check">✓</span>}
        {hasSub && open === i && (
          <div className="ctx-menu ctx-sub" onClick={(e) => e.stopPropagation()}>
            <MenuItems items={it.items} onClose={onClose} />
          </div>
        )}
      </div>
    );
  });
}

// ---------- Dialoge (confirm/prompt) ----------
const DialogCtx = createContext(null);

export function DialogProvider({ children }) {
  const [dlg, setDlg] = useState(null);
  const confirm = useCallback(
    (message, { title = 'Bitte bestätigen', okLabel = 'OK', danger = false } = {}) =>
      new Promise((resolve) => setDlg({ kind: 'confirm', message, title, okLabel, danger, resolve })),
    []
  );
  const prompt = useCallback(
    (title, { label = '', value = '', okLabel = 'OK', multiline = false, placeholder = '' } = {}) =>
      new Promise((resolve) => setDlg({ kind: 'prompt', title, label, value, okLabel, multiline, placeholder, resolve })),
    []
  );
  const alert = useCallback(
    (message, { title = 'Hinweis' } = {}) =>
      new Promise((resolve) => setDlg({ kind: 'alert', message, title, resolve })),
    []
  );
  const close = (result) => {
    dlg?.resolve(result);
    setDlg(null);
  };
  return (
    <DialogCtx.Provider value={{ confirm, prompt, alert }}>
      {children}
      {dlg && <DialogView dlg={dlg} close={close} />}
    </DialogCtx.Provider>
  );
}

function DialogView({ dlg, close }) {
  const [value, setValue] = useState(dlg.value || '');
  const inputRef = useRef(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select?.();
  }, []);
  const cancelValue = dlg.kind === 'prompt' ? null : false;
  const submit = () => close(dlg.kind === 'prompt' ? value : true);
  return (
    <Modal
      title={dlg.title}
      onClose={() => close(cancelValue)}
      footer={
        <>
          {dlg.kind !== 'alert' && <button onClick={() => close(cancelValue)}>Abbrechen</button>}
          <button className={dlg.danger ? 'danger' : 'primary'} onClick={submit}>
            {dlg.okLabel || 'OK'}
          </button>
        </>
      }
    >
      {dlg.message && <div style={{ whiteSpace: 'pre-wrap' }}>{dlg.message}</div>}
      {dlg.kind === 'prompt' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="field">
            {dlg.label}
            {dlg.multiline ? (
              <textarea ref={inputRef} rows={4} value={value} placeholder={dlg.placeholder} onChange={(e) => setValue(e.target.value)} />
            ) : (
              <input ref={inputRef} value={value} placeholder={dlg.placeholder} onChange={(e) => setValue(e.target.value)} />
            )}
          </label>
        </form>
      )}
    </Modal>
  );
}

export function useDialogs() {
  return useContext(DialogCtx);
}

// ---------- Dropdown ----------
export function Dropdown({ label, children, className = '', buttonClass = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open]);
  return (
    <div className={`dropdown ${className}`} ref={ref}>
      <button className={buttonClass} onClick={() => setOpen((o) => !o)}>
        {label}
      </button>
      {open && (
        <div className="dropdown-menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuButton({ icon, children, onClick, danger, disabled }) {
  return (
    <div className={`ctx-item ${danger ? 'danger' : ''} ${disabled ? 'disabled' : ''}`} onClick={onClick}>
      <span className="ctx-icon">{icon || ''}</span>
      <span>{children}</span>
    </div>
  );
}

export function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}
