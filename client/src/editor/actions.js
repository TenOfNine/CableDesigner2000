// Bearbeitungsaktionen auf dem Dokument (über den Store, mit Rückgängig)
import { useEditor } from './store.js';
import {
  createConnector, createTerminal, createSplice, createDevice, createWire, nextLabel, uid, snapshotPart, designationsFor,
} from './model.js';
import { snap } from './geometry.js';

const S = () => useEditor.getState();

export function addComponent(kind, pos, opts = {}) {
  let created = null;
  S().update((doc) => {
    const p = { x: snap(pos.x), y: snap(pos.y) };
    if (kind === 'connector') {
      created = createConnector({ label: opts.label || nextLabel(doc, 'X'), pinCount: opts.pinCount || 2, style: opts.style, part: opts.part, pos: p });
    } else if (kind === 'terminal') {
      created = createTerminal({ label: opts.label || nextLabel(doc, 'T'), subtype: opts.subtype, fn: opts.fn, part: opts.part, pos: p });
    } else if (kind === 'splice') {
      created = createSplice({ label: opts.label || nextLabel(doc, 'S'), part: opts.part, pos: p });
    } else if (kind === 'device') {
      created = createDevice({ label: opts.label || nextLabel(doc, opts.subtype === 'resistor' ? 'R' : 'D'), subtype: opts.subtype, part: opts.part, pos: p });
    }
    if (!created) return false;
    // Layoutposition: in der Layoutansicht an der Klickposition, sonst neben vorhandenen Bauteilen
    if (opts.layPos) created.lay = { x: snap(opts.layPos.x), y: snap(opts.layPos.y) };
    else created.lay = freeLayoutSpot(doc, p);
    if (opts.schPos) created.sch = { x: snap(opts.schPos.x), y: snap(opts.schPos.y) };
    doc.components.push(created);
  });
  if (created) S().select([{ kind: 'component', id: created.id }]);
  return created;
}

function freeLayoutSpot(doc, p) {
  const taken = (x, y) => doc.components.some((c) => Math.hypot(c.lay.x - x, c.lay.y - y) < 60) || doc.nodes.some((n) => Math.hypot(n.x - x, n.y - y) < 40);
  let x = p.x;
  let y = p.y;
  let i = 0;
  while (taken(x, y) && i < 200) {
    x += 80;
    if (++i % 8 === 0) {
      x = p.x;
      y += 80;
    }
  }
  return { x, y };
}

// Freie Position im Schaltplan (für Bauteile, die im Layout angelegt werden)
export function freeSchematicSpot(doc) {
  let maxY = 0;
  let minX = 0;
  for (const c of doc.components) {
    maxY = Math.max(maxY, c.sch.y + 60 + c.pins.length * 22);
    minX = Math.min(minX, c.sch.x);
  }
  return { x: minX, y: doc.components.length ? maxY + 30 : 0 };
}

export function addNote(view, pos, text) {
  const id = uid('n');
  S().update((doc) => {
    doc.notes.push({ id, view, x: snap(pos.x), y: snap(pos.y), text: text || 'Notiz' });
  });
  S().select([{ kind: 'note', id }]);
}

export function deleteSelection() {
  const { selection } = S();
  if (!selection.length) return;
  S().update((doc) => deleteItems(doc, selection));
  S().clearSelection();
}

export function deleteItems(doc, items) {
  const compIds = new Set(items.filter((s) => s.kind === 'component').map((s) => s.id));
  const wireIds = new Set(items.filter((s) => s.kind === 'wire').map((s) => s.id));
  const segIds = new Set(items.filter((s) => s.kind === 'segment').map((s) => s.id));
  const nodeIds = new Set(items.filter((s) => s.kind === 'node').map((s) => s.id));
  const noteIds = new Set(items.filter((s) => s.kind === 'note').map((s) => s.id));

  for (const nid of nodeIds) removeNode(doc, nid);
  doc.segments = doc.segments.filter((s) => !segIds.has(s.id));
  if (compIds.size) {
    doc.components = doc.components.filter((c) => !compIds.has(c.id));
    for (const c of doc.components) if (compIds.has(c.mateId)) c.mateId = null;
    doc.wires = doc.wires.filter((w) => !compIds.has(w.from.c) && !compIds.has(w.to.c));
    doc.segments = doc.segments.filter((s) => !compIds.has(s.a) && !compIds.has(s.b));
  }
  doc.wires = doc.wires.filter((w) => !wireIds.has(w.id));
  doc.notes = doc.notes.filter((n) => !noteIds.has(n.id));
}

// Abzweigpunkt entfernen; bei genau zwei Segmenten werden diese zusammengeführt
export function removeNode(doc, nid) {
  const node = doc.nodes.find((n) => n.id === nid);
  if (!node) return;
  const attached = doc.segments.filter((s) => s.a === nid || s.b === nid);
  if (attached.length === 2) {
    const [s1, s2] = attached;
    const end1 = s1.a === nid ? s1.b : s1.a;
    const end2 = s2.a === nid ? s2.b : s2.a;
    if (end1 !== end2) {
      const pts1 = s1.a === nid ? [...s1.points].reverse() : [...s1.points];
      const pts2 = s2.a === nid ? [...s2.points] : [...s2.points].reverse();
      const merged = {
        ...s1,
        id: uid('s'),
        a: end1,
        b: end2,
        length: (Number(s1.length) || 0) + (Number(s2.length) || 0),
        points: [...pts1, { x: node.x, y: node.y }, ...pts2],
        coverings: mergeCoverings(s1.coverings, s2.coverings),
      };
      doc.segments = doc.segments.filter((s) => s !== s1 && s !== s2);
      doc.segments.push(merged);
      doc.nodes = doc.nodes.filter((n) => n.id !== nid);
      return;
    }
  }
  doc.segments = doc.segments.filter((s) => s.a !== nid && s.b !== nid);
  doc.nodes = doc.nodes.filter((n) => n.id !== nid);
}

function mergeCoverings(a = [], b = []) {
  const out = [...a];
  for (const c of b) if (!out.some((x) => (x.part?.id ?? x.label) === (c.part?.id ?? c.label))) out.push(c);
  return out;
}

export function duplicateSelection(offset = { x: 40, y: 40 }) {
  const { selection } = S();
  const ids = new Set(selection.filter((s) => s.kind === 'component').map((s) => s.id));
  if (!ids.size) return;
  const newSel = [];
  S().update((doc) => {
    const map = new Map();
    for (const c of doc.components.filter((x) => ids.has(x.id))) {
      const copy = structuredClone(c);
      copy.id = uid('c');
      copy.label = nextLabel(doc, c.label.replace(/\d+$/, '') || 'X');
      copy.pins = copy.pins.map((p) => {
        const np = { ...p, id: uid('p') };
        map.set(p.id, np.id);
        return np;
      });
      copy.sch = { x: c.sch.x + offset.x, y: c.sch.y + offset.y };
      copy.lay = { x: c.lay.x + offset.x, y: c.lay.y + offset.y };
      copy.mateId = null;
      map.set(c.id, copy.id);
      doc.components.push(copy);
      newSel.push({ kind: 'component', id: copy.id });
    }
    // Leitungen zwischen kopierten Bauteilen mitkopieren
    for (const w of [...doc.wires]) {
      if (ids.has(w.from.c) && ids.has(w.to.c)) {
        const nw = structuredClone(w);
        nw.id = uid('w');
        nw.label = nextLabel(doc, 'W');
        nw.from = { c: map.get(w.from.c), p: map.get(w.from.p) };
        nw.to = { c: map.get(w.to.c), p: map.get(w.to.p) };
        delete nw.schMid;
        doc.wires.push(nw);
      }
    }
  });
  S().select(newSel);
}

export function connectPins(from, to) {
  if (!from || !to || from.p === to.p) return null;
  let wire = null;
  S().update((doc) => {
    const defaults = { ...(S().wireDefaults || {}) };
    const pf = doc.components.find((c) => c.id === from.c)?.pins.find((p) => p.id === from.p);
    const pt = doc.components.find((c) => c.id === to.c)?.pins.find((p) => p.id === to.p);
    defaults.signal = pf?.fn || pt?.fn || '';
    wire = createWire(doc, from, to, defaults);
    doc.wires.push(wire);
  });
  if (wire) S().select([{ kind: 'wire', id: wire.id }]);
  return wire;
}

// Teil zuordnen; bei Steckverbindern wird die Pinliste angepasst
export function assignPart(compId, part) {
  S().update((doc) => {
    const c = doc.components.find((x) => x.id === compId);
    if (!c) return false;
    c.part = snapshotPart(part);
    if (!part) return;
    if (c.type === 'connector') {
      const d = part.data || {};
      const count = Number(d.cavities) || c.pins.length;
      const names = designationsFor(count, d.designation || 'numeric', d.designations || []);
      const pins = [];
      for (let i = 0; i < count; i++) {
        const old = c.pins[i];
        pins.push(old ? { ...old, name: names[i] } : { id: uid('p'), name: names[i], fn: '' });
      }
      const removed = new Set(c.pins.slice(count).map((p) => p.id));
      c.pins = pins;
      doc.wires = doc.wires.filter((w) => !removed.has(w.from.p) && !removed.has(w.to.p));
      delete c.faceRows;
    } else if (c.type === 'terminal' && part.data?.subtype) {
      c.subtype = part.data.subtype;
    } else if (c.type === 'device') {
      if (part.data?.value) c.value = part.data.value;
    }
  });
}

export function wiresLostByPart(doc, compId, part) {
  const c = doc.components.find((x) => x.id === compId);
  if (!c || c.type !== 'connector' || !part) return 0;
  const count = Number(part.data?.cavities) || c.pins.length;
  const removed = new Set(c.pins.slice(count).map((p) => p.id));
  return doc.wires.filter((w) => removed.has(w.from.p) || removed.has(w.to.p)).length;
}

export function setMate(aId, bId) {
  S().update((doc) => {
    const a = doc.components.find((c) => c.id === aId);
    if (!a) return false;
    // Alte Paarungen lösen
    for (const c of doc.components) {
      if (c.mateId === aId || c.id === a.mateId) c.mateId = null;
      if (bId && (c.mateId === bId)) c.mateId = null;
    }
    a.mateId = bId || null;
    if (bId) {
      const b = doc.components.find((c) => c.id === bId);
      if (b) b.mateId = aId;
    }
  });
}

// ---------- Layout ----------
export function nextNodeLabel(doc) {
  const used = new Set(doc.nodes.map((n) => n.label));
  let i = 1;
  while (used.has(`A${i}`)) i++;
  return `A${i}`;
}

export function addNodeAt(doc, pos) {
  const n = { id: uid('n'), x: snap(pos.x, 5), y: snap(pos.y, 5), label: nextNodeLabel(doc) };
  doc.nodes.push(n);
  return n;
}

export function addSegment(doc, a, b) {
  if (a === b) return null;
  if (doc.segments.some((s) => (s.a === a && s.b === b) || (s.a === b && s.b === a))) return null;
  const seg = { id: uid('s'), a, b, length: 0, points: [], coverings: [], label: '' };
  doc.segments.push(seg);
  return seg;
}

// Segment an einem Punkt teilen (hit von nearestOnPolyline, frac Anteil der Zeichenlänge)
export function splitSegment(doc, segId, hit, frac) {
  const s = doc.segments.find((x) => x.id === segId);
  if (!s) return null;
  const node = addNodeAt(doc, hit.point);
  node.x = hit.point.x;
  node.y = hit.point.y;
  const before = s.points.slice(0, hit.index);
  const after = s.points.slice(hit.index);
  const total = Number(s.length) || 0;
  // Aufteilung proportional zur Zeichnung, auf ganze Millimeter gerundet
  const l1 = Math.round(total * frac);
  const s1 = { ...s, id: uid('s'), b: node.id, points: before, length: total ? l1 : 0, coverings: structuredClone(s.coverings || []) };
  const s2 = { ...s, id: uid('s'), a: node.id, points: after, length: total ? Math.round((total - l1) * 10) / 10 : 0, coverings: structuredClone(s.coverings || []) };
  doc.segments = doc.segments.filter((x) => x.id !== segId);
  doc.segments.push(s1, s2);
  return node;
}
