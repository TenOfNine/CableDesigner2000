// Editing actions on the document (through the store, with undo)
import { useEditor } from './store.js';
import {
  createConnector, createTerminal, createSplice, createDevice, createSubharness, createWire, createCable, nextLabel, uid,
  snapshotPart, designationsFor,
} from './model.js';
import { t } from '../i18n/index.js';
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
    } else if (kind === 'subharness') {
      created = createSubharness({ label: opts.label || nextLabel(doc, 'SH'), harnessId: opts.harnessId, harnessName: opts.harnessName, pos: p });
    }
    if (!created) return false;
    // Layout position: at the click position in the layout view, otherwise next to existing components
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

// Free position in the schematic (for components created in the layout view)
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
    doc.notes.push({ id, view, x: snap(pos.x), y: snap(pos.y), text: text || t('Note') });
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
  const cableIds = new Set(items.filter((s) => s.kind === 'cable').map((s) => s.id));

  for (const nid of nodeIds) removeNode(doc, nid);
  doc.segments = doc.segments.filter((s) => !segIds.has(s.id));
  if (compIds.size) {
    // also covers the virtual interface components of deleted sub-harnesses ("<subId>::<childId>")
    const gone = (id) => !!id && (compIds.has(id) || compIds.has(String(id).split('::')[0]));
    doc.components = doc.components.filter((c) => !compIds.has(c.id));
    for (const c of doc.components) if (gone(c.mateId)) c.mateId = null;
    doc.wires = doc.wires.filter((w) => !gone(w.from.c) && !gone(w.to.c));
    doc.segments = doc.segments.filter((s) => !compIds.has(s.a) && !compIds.has(s.b));
  }
  doc.wires = doc.wires.filter((w) => !wireIds.has(w.id));
  doc.notes = doc.notes.filter((n) => !noteIds.has(n.id));
  // Deleting a cable/twist only dissolves the group, the wires remain
  if (cableIds.size) {
    doc.cables = (doc.cables || []).filter((k) => !cableIds.has(k.id));
    for (const w of doc.wires) if (cableIds.has(w.cableId)) {
      delete w.cableId;
      delete w.cableRole;
    }
  }
  const remaining = new Set((doc.cables || []).map((k) => k.id));
  for (const w of doc.wires) if (w.cableId && !remaining.has(w.cableId)) delete w.cableId;
}

// Removes a branch point; with exactly two segments they are merged
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
    // copy wires between copied components
    for (const w of [...doc.wires]) {
      if (ids.has(w.from.c) && ids.has(w.to.c)) {
        const nw = structuredClone(w);
        nw.id = uid('w');
        nw.label = nextLabel(doc, 'W');
        nw.from = { c: map.get(w.from.c), p: map.get(w.from.p) };
        nw.to = { c: map.get(w.to.c), p: map.get(w.to.p) };
        delete nw.schMid;
        delete nw.cableId;
        delete nw.cableRole;
        doc.wires.push(nw);
      }
    }
  });
  S().select(newSel);
}

// from/to: { c: componentId, p: pinId, fn?: pin function used as default signal name }
export function connectPins(from, to) {
  if (!from || !to || from.p === to.p) return null;
  let wire = null;
  S().update((doc) => {
    const defaults = { ...(S().wireDefaults || {}) };
    defaults.signal = from.fn || to.fn || '';
    wire = createWire(doc, { c: from.c, p: from.p }, { c: to.c, p: to.p }, defaults);
    doc.wires.push(wire);
  });
  if (wire) S().select([{ kind: 'wire', id: wire.id }]);
  return wire;
}

// Assigns a part; for connectors the pin list is adapted
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

// Mates two connectors. bId may be a virtual interface connector of a sub-harness ("<subId>::<childId>");
// in that case only the own connector stores the reference.
export function setMate(aId, bId) {
  S().update((doc) => {
    const a = doc.components.find((c) => c.id === aId);
    if (!a) return false;
    // release previous pairings
    for (const c of doc.components) {
      if (c.mateId === aId || c.id === a.mateId) c.mateId = null;
      if (bId && c.mateId === bId) c.mateId = null;
    }
    a.mateId = bId || null;
    if (bId) {
      const b = doc.components.find((c) => c.id === bId);
      if (b) b.mateId = aId;
    }
  });
}

// ---------- Cables / twisted wires ----------
/** Groups wires into a new multi-core cable or twisted group. Optionally applies the cable's core colours. */
export function groupWires(wireIds, kind, part = null, applyColors = true) {
  let created = null;
  S().update((doc) => {
    const ids = new Set(wireIds);
    const members = doc.wires.filter((w) => ids.has(w.id));
    if (!members.length) return false;
    created = createCable(doc, { kind, part });
    doc.cables = doc.cables || [];
    doc.cables.push(created);
    const colors = part?.data?.coreColors || [];
    members.forEach((w, i) => {
      w.cableId = created.id;
      w.cableRole = 'core';
      if (applyColors && colors[i]) {
        w.color = colors[i];
        w.stripe = null;
      }
      if (part?.data?.crossSection) w.cs = Number(part.data.crossSection);
      if (part?.data?.type) w.type = part.data.type;
    });
    if (!created.cores && kind === 'cable') created.cores = members.length;
  });
  if (created) S().select([{ kind: 'cable', id: created.id }]);
  return created;
}

export function setWireCable(wireId, cableId) {
  S().update((doc) => {
    const w = doc.wires.find((x) => x.id === wireId);
    if (!w) return false;
    if (cableId) {
      w.cableId = cableId;
      w.cableRole = w.cableRole || 'core';
    } else {
      delete w.cableId;
      delete w.cableRole;
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

// Splits a segment at a point (hit from nearestOnPolyline, frac = fraction of the drawn length)
export function splitSegment(doc, segId, hit, frac) {
  const s = doc.segments.find((x) => x.id === segId);
  if (!s) return null;
  const node = addNodeAt(doc, hit.point);
  node.x = hit.point.x;
  node.y = hit.point.y;
  const before = s.points.slice(0, hit.index);
  const after = s.points.slice(hit.index);
  const total = Number(s.length) || 0;
  // split proportionally to the drawing, rounded to whole millimetres
  const l1 = Math.round(total * frac);
  const s1 = { ...s, id: uid('s'), b: node.id, points: before, length: total ? l1 : 0, coverings: structuredClone(s.coverings || []) };
  const s2 = { ...s, id: uid('s'), a: node.id, points: after, length: total ? Math.round((total - l1) * 10) / 10 : 0, coverings: structuredClone(s.coverings || []) };
  doc.segments = doc.segments.filter((x) => x.id !== segId);
  doc.segments.push(s1, s2);
  return node;
}
