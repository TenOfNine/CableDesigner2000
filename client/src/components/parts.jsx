import { useEffect, useMemo, useRef, useState } from 'react';
import { api, partImageUrl } from '../api.js';
import { Modal, useDialogs } from './ui.jsx';
import {
  CATEGORY_LABELS, CATEGORY_SINGULAR, TERMINAL_SUBTYPES, COVERING_SUBTYPES, DEVICE_SUBTYPES,
  CROSS_SECTIONS, designationsFor, faceGrid, partSummary, fmtCs,
} from '../editor/model.js';

// ---------- Steckgesicht (HTML) ----------
export function FaceView({ count, rows, numbering, names, used = new Set(), highlight = new Set(), size = 28 }) {
  const grid = faceGrid(count, rows, numbering);
  const cols = grid[0]?.length || 1;
  return (
    <div className="face-view" style={{ gridTemplateColumns: `repeat(${cols}, ${size}px)` }}>
      {grid.flat().map((idx, i) =>
        idx === null ? (
          <div key={i} />
        ) : (
          <div
            key={i}
            className={`face-cav ${used.has(idx) ? 'used' : ''}`}
            style={{
              width: size,
              height: size,
              ...(highlight.has(idx) ? { background: '#f2c230', color: '#111', borderColor: '#f2c230' } : null),
            }}
            title={names[idx]}
          >
            {names[idx]}
          </div>
        )
      )}
    </div>
  );
}

export function PartThumb({ part, size = 44 }) {
  const url = partImageUrl(part);
  if (!url) return <span className="part-thumb empty" style={{ width: size, height: size }}>—</span>;
  return <img className="part-thumb" src={url} alt="" style={{ width: size, height: size }} loading="lazy" />;
}

// Natürliche Sortierung (DT06-2S vor DT06-12SA)
export function sortParts(list) {
  const key = (p) => `${p.partNumber || '~'} ${p.description}`;
  return [...list].sort((a, b) => key(a).localeCompare(key(b), 'de', { numeric: true, sensitivity: 'base' }));
}

// ---------- Hook: Bibliothek laden ----------
let cache = null;
let cachePromise = null;
export function invalidatePartsCache() {
  cache = null;
  cachePromise = null;
}
export function useParts() {
  const [parts, setParts] = useState(cache);
  const [error, setError] = useState('');
  const reload = async () => {
    invalidatePartsCache();
    return load();
  };
  const load = async () => {
    try {
      if (!cachePromise) cachePromise = api.get('/parts').then((r) => sortParts(r.parts));
      cache = await cachePromise;
      setParts(cache);
    } catch (e) {
      cachePromise = null;
      setError(e.message);
    }
  };
  useEffect(() => {
    load();
  }, []);
  return { parts, error, reload, setParts };
}

// ---------- Suche ----------
export function matchPart(p, q) {
  if (!q) return true;
  const hay = `${p.partNumber} ${p.manufacturer} ${p.description} ${p.data?.series || ''} ${partSummary(p)}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => {
      const m = /^(\w+):(.+)$/.exec(t);
      if (m) {
        const [, key, val] = m;
        if (key === 'polig' || key === 'cavities') return String(p.data?.cavities || '') === val;
        if (key === 'hersteller') return p.manufacturer.toLowerCase().includes(val);
      }
      return hay.includes(t);
    });
}

// ---------- Teile-Auswahl (Dialog) ----------
export function PartPicker({ category, title, onPick, onClose, filter }) {
  const { parts, error } = useParts();
  const [q, setQ] = useState('');
  const inputRef = useRef(null);
  useEffect(() => inputRef.current?.focus(), []);
  const list = useMemo(
    () => (parts || []).filter((p) => p.category === category && (!filter || filter(p)) && matchPart(p, q)),
    [parts, category, q, filter]
  );
  return (
    <Modal title={title || `${CATEGORY_SINGULAR[category]} aus Bibliothek wählen`} onClose={onClose} wide>
      <input
        ref={inputRef}
        placeholder="Suchen … (z. B. „DT06 6“, „polig:4“, „hersteller:molex“)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {error && <div className="error-box">{error}</div>}
      <div className="table-wrap" style={{ maxHeight: '55vh' }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 56 }}></th>
              <th>Teilenummer</th>
              <th>Hersteller</th>
              <th>Beschreibung</th>
              <th>Eckdaten</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {!parts && (
              <tr>
                <td colSpan={6} className="muted">
                  Lade …
                </td>
              </tr>
            )}
            {parts && list.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  Keine passenden Teile. Neue Teile legst du unter „Bibliothek“ an.
                </td>
              </tr>
            )}
            {list.map((p) => (
              <tr key={p.id} style={{ cursor: 'pointer' }} onDoubleClick={() => onPick(p)}>
                <td>
                  <PartThumb part={p} size={40} />
                </td>
                <td className="mono nowrap">{p.partNumber || '—'}</td>
                <td className="nowrap">{p.manufacturer}</td>
                <td>{p.description}</td>
                <td className="nowrap small muted">{partSummary(p)}</td>
                <td className="nowrap">
                  {p.scope === 'own' && <span className="badge accent">Eigen</span>}{' '}
                  <button className="small primary" onClick={() => onPick(p)}>
                    Zuordnen
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

// ---------- Teil anlegen/bearbeiten ----------
const EMPTY_DATA = {
  connector: { cavities: 2, designation: 'numeric', rows: 1, numbering: 'rowwise', gender: 'female', color: { name: 'Schwarz', hex: '#2a2a2a' } },
  terminal: { subtype: 'ring' },
  wire: { type: 'FLRY-B', crossSection: 0.5 },
  splice: {},
  covering: { subtype: 'corrugated' },
  device: { subtype: 'diode' },
};

export function PartEditor({ part, isAdmin, defaultCategory = 'connector', onClose, onSaved, onDeleted }) {
  const dialogs = useDialogs();
  const isNew = !part?.id;
  const readOnly = !isNew && !part.editable;
  const [form, setForm] = useState(() =>
    isNew
      ? { category: defaultCategory, partNumber: '', manufacturer: '', description: '', data: { ...EMPTY_DATA[defaultCategory] }, scope: 'own' }
      : { ...part, data: { ...part.data } }
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [removeImage, setRemoveImage] = useState(false);

  useEffect(() => {
    if (!imageFile) return setImagePreview(null);
    const url = URL.createObjectURL(imageFile);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setD = (k, v) => setForm((f) => ({ ...f, data: { ...f.data, [k]: v } }));
  const d = form.data;

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const data = { ...form.data };
      delete data.designationsText;
      const body = {
        category: form.category,
        partNumber: form.partNumber,
        manufacturer: form.manufacturer,
        description: form.description,
        data,
        scope: form.scope,
      };
      let saved = isNew ? (await api.post('/parts', body)).part : (await api.put(`/parts/${part.id}`, body)).part;
      if (imageFile) saved = (await api.upload(`/parts/${saved.id}/image`, imageFile)).part;
      else if (removeImage && part?.hasImage) {
        await api.del(`/parts/${saved.id}/image`);
        saved = { ...saved, hasImage: false };
      }
      invalidatePartsCache();
      onSaved?.(saved);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    const ok = await dialogs.confirm('Teil endgültig aus der Bibliothek löschen? Bereits zugeordnete Kabelbäume behalten ihre Kopie der Teiledaten.', { okLabel: 'Löschen', danger: true });
    if (!ok) return;
    try {
      await api.del(`/parts/${part.id}`);
      invalidatePartsCache();
      onDeleted?.(part);
    } catch (e) {
      setError(e.message);
    }
  };

  const names = form.category === 'connector'
    ? designationsFor(Number(d.cavities) || 0, d.designation, String(d.designationsText ?? (d.designations || []).join(', ')).split(',').map((s) => s.trim()))
    : [];

  const currentImage = !removeImage && !imagePreview && part?.hasImage ? partImageUrl(part) : null;

  return (
    <Modal
      title={isNew ? 'Neues Teil' : readOnly ? 'Teil ansehen' : 'Teil bearbeiten'}
      onClose={onClose}
      wide
      footer={
        <>
          {!isNew && !readOnly && (
            <button className="danger" onClick={del} style={{ marginRight: 'auto' }}>
              Löschen
            </button>
          )}
          <button onClick={onClose}>{readOnly ? 'Schließen' : 'Abbrechen'}</button>
          {!readOnly && (
            <button className="primary" onClick={save} disabled={busy}>
              Speichern
            </button>
          )}
        </>
      }
    >
      {error && <div className="error-box">{error}</div>}
      {readOnly && <div className="info-box">Globale Teile können nur Administratoren ändern. Über „Als eigenes Teil kopieren“ in der Bibliothek kannst du eine bearbeitbare Kopie anlegen.</div>}
      <fieldset disabled={readOnly} style={{ border: 'none', padding: 0, margin: 0 }}>
        <div className="form-grid">
          {isNew && (
            <label className="field">
              Kategorie
              <select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value, data: { ...EMPTY_DATA[e.target.value] } }))}
              >
                {Object.entries(CATEGORY_SINGULAR).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          )}
          {isNew && (
            <label className="field">
              Ablage
              <select value={form.scope} onChange={(e) => set('scope', e.target.value)}>
                <option value="own">Eigene Bibliothek</option>
                {isAdmin && <option value="global">Globale Bibliothek (für alle)</option>}
              </select>
            </label>
          )}
          <label className="field">
            Teilenummer
            <input value={form.partNumber} onChange={(e) => set('partNumber', e.target.value)} />
          </label>
          <label className="field">
            Hersteller
            <input value={form.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} />
          </label>
          <label className="field full">
            Beschreibung
            <input value={form.description} onChange={(e) => set('description', e.target.value)} />
          </label>
          <label className="field full">
            Link (Datenblatt/Shop)
            <input value={d.url || ''} onChange={(e) => setD('url', e.target.value)} placeholder="https://…" />
          </label>

          {form.category === 'connector' && (
            <>
              <label className="field">
                Serie
                <input value={d.series || ''} onChange={(e) => setD('series', e.target.value)} />
              </label>
              <label className="field">
                Anzahl Kammern
                <input type="number" min={1} max={200} value={d.cavities ?? ''} onChange={(e) => setD('cavities', Math.max(1, Math.min(200, Number(e.target.value) || 1)))} />
              </label>
              <label className="field">
                Kammerbezeichnung
                <select value={d.designation || 'numeric'} onChange={(e) => setD('designation', e.target.value)}>
                  <option value="numeric">Ziffern (1, 2, 3 …)</option>
                  <option value="alpha">Buchstaben (A, B, C …)</option>
                  <option value="custom">Eigene Liste</option>
                </select>
              </label>
              {d.designation === 'custom' ? (
                <label className="field">
                  Bezeichnungen (kommagetrennt)
                  <input
                    value={d.designationsText ?? (d.designations || []).join(', ')}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        data: { ...f.data, designationsText: e.target.value, designations: e.target.value.split(',').map((s) => s.trim()) },
                      }))
                    }
                  />
                </label>
              ) : (
                <div />
              )}
              <label className="field">
                Kontaktart
                <select value={d.gender || 'female'} onChange={(e) => setD('gender', e.target.value)}>
                  <option value="male">Stiftkontakte (male)</option>
                  <option value="female">Buchsenkontakte (female)</option>
                </select>
              </label>
              <label className="field">
                Gehäusefarbe
                <div className="row">
                  <input type="color" value={d.color?.hex || '#2a2a2a'} onChange={(e) => setD('color', { ...(d.color || {}), hex: e.target.value })} />
                  <input className="grow" placeholder="Name" value={d.color?.name || ''} onChange={(e) => setD('color', { ...(d.color || {}), name: e.target.value })} />
                </div>
              </label>
              <label className="field">
                Steckgesicht: Reihen
                <input type="number" min={1} max={20} value={d.rows ?? 1} onChange={(e) => setD('rows', Math.max(1, Number(e.target.value) || 1))} />
              </label>
              <label className="field">
                Steckgesicht: Nummerierung
                <select value={d.numbering || 'rowwise'} onChange={(e) => setD('numbering', e.target.value)}>
                  <option value="rowwise">Zeilenweise</option>
                  <option value="serpentine">Umlaufend (2. Reihe rückwärts)</option>
                </select>
              </label>
              <label className="field">
                Kontakt (Teilenummer)
                <input value={d.contactPart || ''} onChange={(e) => setD('contactPart', e.target.value)} />
              </label>
              <label className="field">
                Kontakt: Leitungsbereich
                <input value={d.contactRange || ''} onChange={(e) => setD('contactRange', e.target.value)} placeholder="z. B. 0,5–1,0 mm²" />
              </label>
              <label className="field">
                Sekundärverriegelung / Zubehör
                <input value={d.lockPart || ''} onChange={(e) => setD('lockPart', e.target.value)} />
              </label>
              <label className="field">
                Gegenstück
                <input value={d.matingPart || ''} onChange={(e) => setD('matingPart', e.target.value)} />
              </label>
              <div className="full col" style={{ gap: 4 }}>
                <span className="muted small">Vorschau Steckgesicht (schematisch)</span>
                {names.length > 0 && <FaceView count={names.length} rows={d.rows} numbering={d.numbering} names={names} />}
              </div>
            </>
          )}

          {form.category === 'terminal' && (
            <>
              <label className="field">
                Art
                <select value={d.subtype || 'ring'} onChange={(e) => setD('subtype', e.target.value)}>
                  {TERMINAL_SUBTYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Bolzen / Größe
                <input value={d.stud || ''} onChange={(e) => setD('stud', e.target.value)} placeholder="z. B. M6" />
              </label>
              <label className="field">
                Querschnittsbereich
                <input value={d.crossSectionRange || ''} onChange={(e) => setD('crossSectionRange', e.target.value)} />
              </label>
            </>
          )}

          {form.category === 'wire' && (
            <>
              <label className="field">
                Leitungstyp
                <input value={d.type || ''} onChange={(e) => setD('type', e.target.value)} placeholder="z. B. FLRY-B" />
              </label>
              <label className="field">
                Querschnitt
                <select value={d.crossSection || 0.5} onChange={(e) => setD('crossSection', Number(e.target.value))}>
                  {CROSS_SECTIONS.map((c) => (
                    <option key={c} value={c}>
                      {fmtCs(c)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Außendurchmesser (mm)
                <input type="number" step="0.1" min={0} value={d.outerDiameter ?? ''} onChange={(e) => setD('outerDiameter', e.target.value === '' ? undefined : Number(e.target.value))} />
              </label>
            </>
          )}

          {form.category === 'splice' && (
            <label className="field">
              Querschnittsbereich
              <input value={d.crossSectionRange || ''} onChange={(e) => setD('crossSectionRange', e.target.value)} />
            </label>
          )}

          {form.category === 'covering' && (
            <>
              <label className="field">
                Art
                <select value={d.subtype || 'corrugated'} onChange={(e) => setD('subtype', e.target.value)}>
                  {COVERING_SUBTYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Innendurchmesser (mm)
                <input type="number" step="0.5" min={0} value={d.innerDiameter ?? ''} onChange={(e) => setD('innerDiameter', e.target.value === '' ? undefined : Number(e.target.value))} />
              </label>
            </>
          )}

          {form.category === 'device' && (
            <>
              <label className="field">
                Art
                <select value={d.subtype || 'diode'} onChange={(e) => setD('subtype', e.target.value)}>
                  {DEVICE_SUBTYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Wert
                <input value={d.value || ''} onChange={(e) => setD('value', e.target.value)} placeholder="z. B. 120 Ω" />
              </label>
            </>
          )}

          <label className="field full">
            Notizen
            <textarea rows={2} value={d.notes || ''} onChange={(e) => setD('notes', e.target.value)} />
          </label>

          <div className="field full">
            <span>Bild</span>
            <div className="row">
              {imagePreview || currentImage ? (
                <img src={imagePreview || currentImage} alt="" className="part-thumb" style={{ width: 90, height: 90 }} />
              ) : (
                <span className="part-thumb empty" style={{ width: 90, height: 90 }}>
                  kein Bild
                </span>
              )}
              {!readOnly && (
                <div className="col" style={{ gap: 6 }}>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={(e) => {
                      setImageFile(e.target.files?.[0] || null);
                      setRemoveImage(false);
                    }}
                  />
                  {(part?.hasImage || imageFile) && (
                    <button
                      className="small"
                      onClick={() => {
                        setImageFile(null);
                        setRemoveImage(true);
                      }}
                    >
                      Bild entfernen
                    </button>
                  )}
                  <span className="muted small">PNG, JPEG, WebP oder GIF, max. 3 MB</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </fieldset>
    </Modal>
  );
}

export { CATEGORY_LABELS };
