import { useEffect, useState } from 'react';

// Textfeld, das erst bei Enter/Verlassen übernimmt (ein Rückgängig-Schritt pro Änderung)
export function TextField({ value, onCommit, disabled, placeholder, className = '', multiline = false, rows = 3, list }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => setV(value ?? ''), [value]);
  const commit = () => {
    if ((value ?? '') !== v) onCommit(v);
  };
  if (multiline) {
    return (
      <textarea
        className={className}
        rows={rows}
        value={v}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setV(value ?? '');
          e.stopPropagation();
        }}
      />
    );
  }
  return (
    <input
      className={className}
      value={v}
      disabled={disabled}
      placeholder={placeholder}
      list={list}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setV(value ?? '');
        e.stopPropagation();
      }}
    />
  );
}

// Zahlenfeld mit deutschem Dezimalkomma; leer = null
export function NumberField({ value, onCommit, disabled, placeholder, className = '', min = 0, allowEmpty = false }) {
  const fmt = (n) => (n === null || n === undefined || n === '' ? '' : String(n).replace('.', ','));
  const [v, setV] = useState(fmt(value));
  useEffect(() => setV(fmt(value)), [value]);
  const commit = () => {
    const raw = v.trim().replace(',', '.');
    if (raw === '') {
      if (allowEmpty && value !== null && value !== undefined && value !== '') onCommit(null);
      else if (!allowEmpty) setV(fmt(value));
      return;
    }
    const n = Number(raw);
    if (Number.isNaN(n)) return setV(fmt(value));
    const clamped = Math.max(min, n);
    if (clamped !== value) onCommit(clamped);
    else setV(fmt(value));
  };
  return (
    <input
      className={className}
      inputMode="decimal"
      value={v}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setV(fmt(value));
        e.stopPropagation();
      }}
    />
  );
}
