// Datenmodell, Konstanten und Fabrikfunktionen für Kabelbaum-Dokumente

export const SCHEMA_VERSION = 1;

// Aderfarben nach IEC 60757
export const WIRE_COLORS = [
  { code: 'BK', name: 'Schwarz', hex: '#1c1c1c' },
  { code: 'BN', name: 'Braun', hex: '#7a4a22' },
  { code: 'RD', name: 'Rot', hex: '#e03c3c' },
  { code: 'OG', name: 'Orange', hex: '#f08a24' },
  { code: 'YE', name: 'Gelb', hex: '#f2c230' },
  { code: 'GN', name: 'Grün', hex: '#3fae4a' },
  { code: 'BU', name: 'Blau', hex: '#2f73d8' },
  { code: 'VT', name: 'Violett', hex: '#8a4fd1' },
  { code: 'GY', name: 'Grau', hex: '#8e939b' },
  { code: 'WH', name: 'Weiß', hex: '#f2f2f2' },
  { code: 'PK', name: 'Rosa', hex: '#f07aa8' },
  { code: 'TQ', name: 'Türkis', hex: '#2bb5b0' },
  { code: 'GNYE', name: 'Grün-Gelb', hex: '#7fbf3a' },
];
const COLOR_MAP = new Map(WIRE_COLORS.map((c) => [c.code, c]));
export const colorByCode = (code) => COLOR_MAP.get(code) || { code: code || '?', name: code || '?', hex: '#999999' };

export function wireColorLabel(w) {
  const c = colorByCode(w.color);
  return w.stripe ? `${c.code}/${colorByCode(w.stripe).code}` : c.code;
}
export function wireColorName(w) {
  const c = colorByCode(w.color);
  return w.stripe ? `${c.name}/${colorByCode(w.stripe).name}` : c.name;
}

export const CROSS_SECTIONS = [0.14, 0.25, 0.35, 0.5, 0.75, 1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50];

// Nächstliegende AWG-Größe zu einem Querschnitt (mm²)
export function awgFor(cs) {
  if (!cs || cs <= 0) return null;
  const d = Math.sqrt((4 * cs) / Math.PI); // Durchmesser mm
  const n = 36 - 39 * (Math.log(d / 0.127) / Math.log(92));
  const r = Math.round(n);
  if (r <= 0) return r === 0 ? '1/0' : `${-r + 1}/0`;
  return String(r);
}

// Typische Außendurchmesser FLRY-B (mm), Rückfall: Näherung
const OD_FLRY = { 0.35: 1.3, 0.5: 1.6, 0.75: 1.9, 1: 2.1, 1.5: 2.4, 2.5: 3.0, 4: 3.7, 6: 4.3 };
export function outerDiameter(w) {
  if (w.outerDiameter) return w.outerDiameter;
  if (OD_FLRY[w.cs]) return OD_FLRY[w.cs];
  return Math.round((Math.sqrt((4 * (w.cs || 0.5)) / Math.PI) * 1.45 + 0.4) * 10) / 10;
}

export const fmtNum = (n, digits = 1) =>
  n === null || n === undefined || Number.isNaN(n)
    ? '–'
    : Number(n).toLocaleString('de-DE', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
export const fmtCs = (cs) => (cs ? `${fmtNum(cs, 2)} mm²` : '–');
export const fmtLen = (mm) => (mm === null || mm === undefined ? '–' : `${fmtNum(Math.round(mm), 0)} mm`);

export const CATEGORY_LABELS = {
  connector: 'Steckverbinder',
  terminal: 'Terminals',
  wire: 'Leitungen',
  splice: 'Spleiße',
  covering: 'Ummantelungen',
  device: 'Bauelemente',
};
export const CATEGORY_SINGULAR = {
  connector: 'Steckverbinder',
  terminal: 'Terminal',
  wire: 'Leitung',
  splice: 'Spleiß',
  covering: 'Ummantelung',
  device: 'Bauelement',
};

export const TERMINAL_SUBTYPES = [
  { value: 'ring', label: 'Ringkabelschuh', symbol: '⊸' },
  { value: 'spade', label: 'Gabelkabelschuh', symbol: '⫟' },
  { value: 'ferrule', label: 'Aderendhülse', symbol: '▭' },
  { value: 'male_qc', label: 'Flachstecker', symbol: '▸' },
  { value: 'female_qc', label: 'Flachsteckhülse', symbol: '◂' },
  { value: 'loose_end', label: 'Offenes Aderende', symbol: '—' },
];
export const terminalSubtype = (v) => TERMINAL_SUBTYPES.find((t) => t.value === v) || TERMINAL_SUBTYPES[0];

export const COVERING_SUBTYPES = [
  { value: 'corrugated', label: 'Wellrohr' },
  { value: 'tape', label: 'Klebeband' },
  { value: 'braid', label: 'Geflechtschlauch' },
  { value: 'heatshrink', label: 'Schrumpfschlauch' },
  { value: 'other', label: 'Sonstige' },
];
export const DEVICE_SUBTYPES = [
  { value: 'diode', label: 'Diode', pins: ['A', 'K'] },
  { value: 'resistor', label: 'Widerstand', pins: ['1', '2'] },
];

export const GENDER_LABELS = { male: 'Stiftkontakte (male)', female: 'Buchsenkontakte (female)' };

let counter = 0;
export function uid(prefix = 'x') {
  counter = (counter + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${counter.toString(36)}`;
}

// Kammerbezeichnungen
export function alphaDesignation(i) {
  let s = '';
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}
export function designationsFor(count, style = 'numeric', custom = []) {
  const out = [];
  for (let i = 0; i < count; i++) {
    if (style === 'alpha') out.push(alphaDesignation(i));
    else if (style === 'custom' && custom[i]) out.push(String(custom[i]));
    else out.push(String(i + 1));
  }
  return out;
}

// Anordnung der Kammern für die Steckgesicht-Ansicht (Indizes in die Pinliste)
export function faceGrid(count, rows = 1, numbering = 'rowwise') {
  const r = Math.max(1, Math.min(rows || 1, count || 1));
  const cols = Math.ceil(count / r);
  const grid = [];
  for (let i = 0; i < r; i++) {
    let row = [];
    for (let j = 0; j < cols; j++) {
      const idx = i * cols + j;
      row.push(idx < count ? idx : null);
    }
    if (numbering === 'serpentine' && i % 2 === 1) row = row.reverse();
    grid.push(row);
  }
  return grid;
}

// Momentaufnahme eines Bibliotheksteils im Dokument
export function snapshotPart(part) {
  if (!part) return null;
  return {
    id: part.id,
    category: part.category,
    partNumber: part.partNumber || '',
    manufacturer: part.manufacturer || '',
    description: part.description || '',
    data: part.data || {},
    hasImage: !!part.hasImage,
    imageVersion: part.imageVersion || '',
  };
}

export function partTitle(part) {
  if (!part) return '';
  return part.partNumber || part.description || '';
}

export function partSummary(part) {
  if (!part) return '';
  const d = part.data || {};
  const bits = [];
  if (part.category === 'connector') {
    if (d.cavities) bits.push(`${d.cavities}-polig`);
    if (d.gender) bits.push(d.gender === 'male' ? 'Stift' : 'Buchse');
    if (d.color?.name) bits.push(d.color.name);
  } else if (part.category === 'wire') {
    if (d.crossSection) bits.push(fmtCs(d.crossSection));
    if (d.type) bits.push(d.type);
  } else if (part.category === 'terminal') {
    bits.push(terminalSubtype(d.subtype).label);
    if (d.stud) bits.push(d.stud);
  } else if (part.category === 'covering') {
    const st = COVERING_SUBTYPES.find((s) => s.value === d.subtype);
    if (st) bits.push(st.label);
    if (d.innerDiameter) bits.push(`Ø ${fmtNum(d.innerDiameter)} mm`);
  } else if (part.category === 'device') {
    const st = DEVICE_SUBTYPES.find((s) => s.value === d.subtype);
    if (st) bits.push(st.label);
    if (d.value) bits.push(d.value);
  }
  return bits.join(' · ');
}

export function emptyDoc() {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: {
      drawingNumber: '',
      revision: 'A',
      author: '',
      extraPerEnd: 0,
      extraPercent: 0,
      defaultCrossSection: 0.5,
      defaultWireType: 'FLRY-B',
      defaultColor: 'BK',
    },
    components: [],
    wires: [],
    nodes: [],
    segments: [],
    notes: [],
  };
}

// Dokument aus älteren/unvollständigen Ständen ergänzen
export function normalizeDoc(doc) {
  const base = emptyDoc();
  const d = { ...base, ...(doc || {}) };
  d.settings = { ...base.settings, ...(doc?.settings || {}) };
  for (const k of ['components', 'wires', 'nodes', 'segments', 'notes']) if (!Array.isArray(d[k])) d[k] = [];
  for (const c of d.components) {
    c.sch = c.sch || { x: 0, y: 0 };
    c.lay = c.lay || { x: c.sch.x, y: c.sch.y };
    c.pins = Array.isArray(c.pins) ? c.pins : [];
    c.show = c.show || {};
    c.callouts = c.callouts || {};
  }
  for (const s of d.segments) {
    s.points = Array.isArray(s.points) ? s.points : [];
    s.coverings = Array.isArray(s.coverings) ? s.coverings : [];
    if (typeof s.length !== 'number') s.length = 0;
  }
  return d;
}

export function nextLabel(doc, prefix) {
  const used = new Set(doc.components.map((c) => c.label));
  for (const w of doc.wires) used.add(w.label);
  let i = 1;
  while (used.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

function makePins(names, fns = []) {
  return names.map((name, i) => ({ id: uid('p'), name, fn: fns[i] || '' }));
}

export function createConnector({ label, pinCount = 2, style = 'numeric', part = null, pos }) {
  const d = part?.data || {};
  const count = part ? d.cavities || pinCount : pinCount;
  const names = designationsFor(count, part ? d.designation || 'numeric' : style, d.designations || []);
  return {
    id: uid('c'),
    type: 'connector',
    label,
    part: snapshotPart(part),
    pins: makePins(names),
    mateId: null,
    sch: { ...pos },
    lay: { ...pos },
    show: {},
    callouts: {},
    excludeFromBom: false,
    notes: '',
  };
}

export function createTerminal({ label, subtype = 'ring', fn = '', part = null, pos }) {
  return {
    id: uid('c'),
    type: 'terminal',
    subtype: part?.data?.subtype || subtype,
    label,
    part: snapshotPart(part),
    pins: makePins(['1'], [fn]),
    sch: { ...pos },
    lay: { ...pos },
    show: {},
    callouts: {},
    excludeFromBom: false,
    notes: '',
  };
}

export function createSplice({ label, part = null, pos }) {
  return {
    id: uid('c'),
    type: 'splice',
    label,
    part: snapshotPart(part),
    pins: makePins(['S']),
    sch: { ...pos },
    lay: { ...pos },
    show: {},
    callouts: {},
    excludeFromBom: false,
    notes: '',
  };
}

export function createDevice({ label, subtype = 'diode', value = '', part = null, pos }) {
  const st = DEVICE_SUBTYPES.find((s) => s.value === (part?.data?.subtype || subtype)) || DEVICE_SUBTYPES[0];
  return {
    id: uid('c'),
    type: 'device',
    subtype: st.value,
    value: part?.data?.value || value,
    label,
    part: snapshotPart(part),
    pins: makePins(st.pins),
    sch: { ...pos },
    lay: { ...pos },
    show: {},
    callouts: {},
    excludeFromBom: false,
    notes: '',
  };
}

export function createWire(doc, from, to, defaults = {}) {
  const s = doc.settings;
  return {
    id: uid('w'),
    label: nextLabel(doc, 'W'),
    from,
    to,
    signal: defaults.signal || '',
    color: defaults.color || s.defaultColor || 'BK',
    stripe: defaults.stripe || null,
    cs: defaults.cs || s.defaultCrossSection || 0.5,
    type: defaults.type || s.defaultWireType || 'FLRY-B',
    part: defaults.part || null,
    lengthExtra: 0,
    lengthOverride: null,
    notes: '',
  };
}

export const COMPONENT_TYPE_LABEL = {
  connector: 'Steckverbinder',
  terminal: 'Terminal',
  splice: 'Spleiß',
  device: 'Bauelement',
};
