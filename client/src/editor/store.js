import { create } from 'zustand';
import { normalizeDoc } from './model.js';

const HISTORY_LIMIT = 200;

export const useEditor = create((set, get) => ({
  doc: null,
  meta: null, // { id, name, description, projectId, breadcrumb, updatedByName }
  permission: 'read',
  version: 0,
  view: 'schematic',
  selection: [], // [{ kind, id }]
  hover: null, // { wireIds: string[] }
  past: [],
  future: [],
  saveState: 'saved', // saved | dirty | saving | error | conflict
  saveError: '',
  docRevision: 0, // zählt jede Änderung für Autosave
  viewports: {
    schematic: { x: 60, y: 60, k: 1 },
    layout: { x: 60, y: 60, k: 1 },
  },
  layoutTool: 'select',
  wireDefaults: null,

  load(harness, permission, breadcrumb) {
    set({
      doc: normalizeDoc(harness.data),
      meta: {
        id: harness.id,
        name: harness.name,
        description: harness.description,
        projectId: harness.projectId,
        breadcrumb,
        updatedByName: harness.updatedByName,
      },
      permission,
      version: harness.version,
      selection: [],
      hover: null,
      past: [],
      future: [],
      saveState: 'saved',
      saveError: '',
      docRevision: 0,
    });
  },

  // Änderung mit Rückgängig-Eintrag; fn bekommt eine tiefe Kopie
  update(fn, { history = true } = {}) {
    const { doc, past, permission } = get();
    if (!doc || permission === 'read') return;
    const next = structuredClone(doc);
    const r = fn(next);
    if (r === false) return;
    set({
      doc: next,
      past: history ? [...past, doc].slice(-HISTORY_LIMIT) : past,
      future: history ? [] : get().future,
      saveState: 'dirty',
      docRevision: get().docRevision + 1,
    });
  },

  // Schnelle Änderung ohne tiefe Kopie (für Ziehen), fn gibt neues Dokument zurück
  replaceDoc(nextDoc) {
    if (get().permission === 'read') return;
    set({ doc: nextDoc, saveState: 'dirty', docRevision: get().docRevision + 1 });
  },

  checkpoint() {
    const { doc, past } = get();
    set({ past: [...past, doc].slice(-HISTORY_LIMIT), future: [] });
  },

  undo() {
    const { past, future, doc } = get();
    if (!past.length || get().permission === 'read') return;
    const prev = past[past.length - 1];
    set({
      doc: prev,
      past: past.slice(0, -1),
      future: [doc, ...future].slice(0, HISTORY_LIMIT),
      saveState: 'dirty',
      docRevision: get().docRevision + 1,
      selection: filterSelection(get().selection, prev),
    });
  },

  redo() {
    const { past, future, doc } = get();
    if (!future.length || get().permission === 'read') return;
    const next = future[0];
    set({
      doc: next,
      past: [...past, doc].slice(-HISTORY_LIMIT),
      future: future.slice(1),
      saveState: 'dirty',
      docRevision: get().docRevision + 1,
      selection: filterSelection(get().selection, next),
    });
  },

  setView(view) {
    set({ view, hover: null });
  },
  select(items, additive = false) {
    if (!additive) return set({ selection: items });
    const cur = get().selection;
    const out = [...cur];
    for (const it of items) {
      const i = out.findIndex((s) => s.kind === it.kind && s.id === it.id);
      if (i >= 0) out.splice(i, 1);
      else out.push(it);
    }
    set({ selection: out });
  },
  clearSelection() {
    set({ selection: [] });
  },
  setHover(hover) {
    const cur = get().hover;
    if (!hover && !cur) return;
    if (hover && cur && hover.key === cur.key) return;
    set({ hover });
  },
  setViewport(view, vp) {
    set({ viewports: { ...get().viewports, [view]: vp } });
  },
  setLayoutTool(t) {
    set({ layoutTool: t });
  },
  setMeta(patch) {
    set({ meta: { ...get().meta, ...patch } });
  },
  setSaveState(saveState, saveError = '') {
    set({ saveState, saveError });
  },
  setVersion(version) {
    set({ version });
  },
  setWireDefaults(d) {
    set({ wireDefaults: d });
  },
}));

function filterSelection(sel, doc) {
  const ids = new Set([
    ...doc.components.map((c) => c.id),
    ...doc.wires.map((w) => w.id),
    ...doc.segments.map((s) => s.id),
    ...doc.nodes.map((n) => n.id),
    ...doc.notes.map((n) => n.id),
  ]);
  return sel.filter((s) => ids.has(s.id));
}

export const isSelected = (sel, kind, id) => sel.some((s) => s.kind === kind && s.id === id);
