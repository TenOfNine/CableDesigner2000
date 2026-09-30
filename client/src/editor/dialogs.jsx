import { useState } from 'react';
import { Modal } from '../components/ui.jsx';
import { CROSS_SECTIONS, WIRE_COLORS, fmtCs } from './model.js';

export function AddConnectorDialog({ onClose, onCreate, onPickFromLibrary }) {
  const [label, setLabel] = useState('');
  const [pins, setPins] = useState(2);
  const [style, setStyle] = useState('numeric');
  const submit = () => onCreate({ label: label.trim() || undefined, pinCount: Math.max(1, Math.min(200, Number(pins) || 1)), style });
  return (
    <Modal
      title="Steckverbinder hinzufügen"
      onClose={onClose}
      footer={
        <>
          <button onClick={onPickFromLibrary} style={{ marginRight: 'auto' }}>
            Aus Bibliothek wählen …
          </button>
          <button onClick={onClose}>Abbrechen</button>
          <button className="primary" onClick={submit}>
            Hinzufügen
          </button>
        </>
      }
    >
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="field full">
          Bezeichnung
          <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="z. B. Injector 1, ECU, X1" />
        </label>
        <label className="field">
          Anzahl Pins
          <input type="number" min={1} max={200} value={pins} onChange={(e) => setPins(e.target.value)} />
        </label>
        <label className="field">
          Pinbezeichnung
          <select value={style} onChange={(e) => setStyle(e.target.value)}>
            <option value="numeric">1, 2, 3 …</option>
            <option value="alpha">A, B, C …</option>
          </select>
        </label>
        <button type="submit" className="hidden" />
      </form>
      <p className="muted small">Ein Bibliotheksteil kannst du auch später im Eigenschaften-Bereich zuordnen.</p>
    </Modal>
  );
}

export function SettingsDialog({ meta, settings, readOnly, onClose, onSave }) {
  const [name, setName] = useState(meta.name);
  const [description, setDescription] = useState(meta.description || '');
  const [s, setS] = useState({ ...settings });
  const set = (k) => (e) => setS({ ...s, [k]: e.target.value });
  const num = (v) => {
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };
  return (
    <Modal
      title="Kabelbaum-Einstellungen"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>{readOnly ? 'Schließen' : 'Abbrechen'}</button>
          {!readOnly && (
            <button
              className="primary"
              onClick={() =>
                onSave({
                  name: name.trim() || meta.name,
                  description,
                  settings: {
                    ...s,
                    extraPerEnd: Math.max(0, num(s.extraPerEnd)),
                    extraPercent: Math.max(0, num(s.extraPercent)),
                    defaultCrossSection: Number(s.defaultCrossSection),
                  },
                })
              }
            >
              Speichern
            </button>
          )}
        </>
      }
    >
      <fieldset disabled={readOnly} style={{ border: 'none', padding: 0, margin: 0 }}>
        <div className="form-grid">
          <label className="field full">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field full">
            Beschreibung
            <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label className="field">
            Zeichnungsnummer
            <input value={s.drawingNumber || ''} onChange={set('drawingNumber')} />
          </label>
          <label className="field">
            Revision
            <input value={s.revision || ''} onChange={set('revision')} />
          </label>
          <label className="field full">
            Bearbeiter (für Schriftfeld)
            <input value={s.author || ''} onChange={set('author')} placeholder="leer = eigener Anzeigename" />
          </label>
          <label className="field">
            Längenzugabe je Leitungsende (mm)
            <input inputMode="decimal" value={String(s.extraPerEnd ?? 0).replace('.', ',')} onChange={set('extraPerEnd')} />
          </label>
          <label className="field">
            Längenzuschlag (%)
            <input inputMode="decimal" value={String(s.extraPercent ?? 0).replace('.', ',')} onChange={set('extraPercent')} />
          </label>
          <div className="full small muted">
            Leitungslänge = Weg im Layout × (1 + Zuschlag) + 2 × Zugabe je Ende + individuelle Zusatzlänge. Die Zugabe deckt z. B.
            Abisolierlänge und Reserve am Stecker ab.
          </div>
          <label className="field">
            Vorgabe Querschnitt
            <select value={s.defaultCrossSection} onChange={set('defaultCrossSection')}>
              {CROSS_SECTIONS.map((c) => (
                <option key={c} value={c}>
                  {fmtCs(c)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Vorgabe Farbe
            <select value={s.defaultColor} onChange={set('defaultColor')}>
              {WIRE_COLORS.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
          </label>
          <label className="field full">
            Vorgabe Leitungstyp
            <input value={s.defaultWireType || ''} onChange={set('defaultWireType')} />
          </label>
        </div>
      </fieldset>
    </Modal>
  );
}

export function PrintDialog({ onClose, onPrint }) {
  const [paper, setPaper] = useState('A4');
  const [orientation, setOrientation] = useState('landscape');
  const [sections, setSections] = useState({ schematic: true, layout: true, wires: true, bom: true, pinout: false, segments: false });
  const toggle = (k) => setSections({ ...sections, [k]: !sections[k] });
  const labels = {
    schematic: 'Schaltplan',
    layout: 'Layout / Formboard',
    wires: 'Leitungsliste',
    bom: 'Stückliste',
    pinout: 'Pinbelegung',
    segments: 'Segmente',
  };
  return (
    <Modal
      title="Drucken"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Abbrechen</button>
          <button className="primary" disabled={!Object.values(sections).some(Boolean)} onClick={() => onPrint({ paper, orientation, sections })}>
            Drucken …
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field">
          Papierformat
          <select value={paper} onChange={(e) => setPaper(e.target.value)}>
            <option value="A4">A4</option>
            <option value="A3">A3</option>
          </select>
        </label>
        <label className="field">
          Ausrichtung
          <select value={orientation} onChange={(e) => setOrientation(e.target.value)}>
            <option value="landscape">Querformat</option>
            <option value="portrait">Hochformat</option>
          </select>
        </label>
      </div>
      <div className="col" style={{ gap: 6 }}>
        <span className="small muted">Inhalt</span>
        {Object.keys(labels).map((k) => (
          <label key={k} className="check">
            <input type="checkbox" checked={sections[k]} onChange={() => toggle(k)} />
            {labels[k]}
          </label>
        ))}
      </div>
      <p className="small muted">
        Zeichnungen werden auf die Seite eingepasst und erhalten ein Schriftfeld. Über den Druckdialog des Browsers kannst du auch als PDF
        speichern.
      </p>
    </Modal>
  );
}

export function ImageDialog({ defaultView, onClose, onExport }) {
  const [view, setView] = useState(defaultView === 'layout' ? 'layout' : 'schematic');
  const [format, setFormat] = useState('png');
  const [theme, setTheme] = useState('light');
  const [scale, setScale] = useState(2);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Als Bild exportieren"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Abbrechen</button>
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onExport({ view, format, theme, scale });
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Erzeuge …' : 'Exportieren'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field">
          Ansicht
          <select value={view} onChange={(e) => setView(e.target.value)}>
            <option value="schematic">Schaltplan</option>
            <option value="layout">Layout / Formboard</option>
          </select>
        </label>
        <label className="field">
          Format
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="png">PNG (Rastergrafik)</option>
            <option value="svg">SVG (Vektorgrafik)</option>
          </select>
        </label>
        <label className="field">
          Darstellung
          <select value={theme} onChange={(e) => setTheme(e.target.value)}>
            <option value="light">Hell (weißer Hintergrund)</option>
            <option value="dark">Dunkel</option>
          </select>
        </label>
        {format === 'png' && (
          <label className="field">
            Auflösung
            <select value={scale} onChange={(e) => setScale(Number(e.target.value))}>
              <option value={1}>1× (Bildschirm)</option>
              <option value={2}>2× (scharf)</option>
              <option value={3}>3× (hoch)</option>
            </select>
          </label>
        )}
      </div>
    </Modal>
  );
}
