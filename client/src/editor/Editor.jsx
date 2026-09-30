import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { ContextMenu, Dropdown, MenuButton, useDialogs } from '../components/ui.jsx';
import { PartPicker } from '../components/parts.jsx';
import { useEditor } from './store.js';
import { derive } from './derive.js';
import SchematicView from './SchematicView.jsx';
import LayoutView from './LayoutView.jsx';
import TablesView from './TablesView.jsx';
import Inspector from './Inspector.jsx';
import PrintView from './PrintView.jsx';
import { AddConnectorDialog, SettingsDialog, PrintDialog, ImageDialog } from './dialogs.jsx';
import { exportExcel, exportPng, exportSvg } from './exports.jsx';
import {
  addComponent, addNote, deleteSelection, duplicateSelection, assignPart, setMate, removeNode, splitSegment,
  freeSchematicSpot, wiresLostByPart, addNodeAt,
} from './actions.js';
import { TERMINAL_SUBTYPES, WIRE_COLORS, CROSS_SECTIONS, fmtCs, uid, snapshotPart, CATEGORY_SINGULAR } from './model.js';
import { segmentPoints, nearestOnPolyline, fractionAlong } from './geometry.js';

export default function Editor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const dialogs = useDialogs();
  const [loadError, setLoadError] = useState('');
  const doc = useEditor((s) => s.doc);
  const meta = useEditor((s) => s.meta);
  const view = useEditor((s) => s.view);
  const setView = useEditor((s) => s.setView);
  const permission = useEditor((s) => s.permission);
  const saveState = useEditor((s) => s.saveState);
  const saveError = useEditor((s) => s.saveError);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const readOnly = permission === 'read';

  const [ctx, setCtx] = useState(null);
  const [picker, setPicker] = useState(null); // { category, onPick }
  const [addConn, setAddConn] = useState(null); // { pos, view }
  const [showSettings, setShowSettings] = useState(false);
  const [printDlg, setPrintDlg] = useState(false);
  const [printJob, setPrintJob] = useState(null);
  const [imageDlg, setImageDlg] = useState(false);
  const [fitSignal, setFitSignal] = useState(0);
  const loadedId = useRef(null);

  // ---------- Laden ----------
  useEffect(() => {
    let alive = true;
    setLoadError('');
    api
      .get(`/harnesses/${id}`)
      .then(({ harness, permission, breadcrumb }) => {
        if (!alive) return;
        useEditor.getState().load(harness, permission, breadcrumb);
        loadedId.current = id;
      })
      .catch((e) => alive && setLoadError(e.message));
    return () => {
      alive = false;
    };
  }, [id]);

  const derived = useMemo(() => (doc ? derive(doc) : null), [doc]);

  // ---------- Speichern ----------
  const saving = useRef(false);
  const save = useCallback(async () => {
    const st = useEditor.getState();
    if (saving.current || st.permission === 'read' || !st.meta || String(st.meta.id) !== String(id)) return;
    if (st.saveState === 'saved' || st.saveState === 'conflict') return;
    saving.current = true;
    const rev = st.docRevision;
    st.setSaveState('saving');
    try {
      const r = await api.put(`/harnesses/${st.meta.id}`, { data: st.doc, version: st.version });
      useEditor.getState().setVersion(r.version);
      useEditor.getState().setSaveState(useEditor.getState().docRevision === rev ? 'saved' : 'dirty');
    } catch (e) {
      useEditor.getState().setSaveState(e.status === 409 ? 'conflict' : 'error', e.message);
    } finally {
      saving.current = false;
      // Während des Speicherns entstandene Änderungen nachziehen
      if (useEditor.getState().saveState === 'dirty') setTimeout(() => saveRef.current?.(), 300);
    }
  }, [id]);
  const saveRef = useRef(save);
  saveRef.current = save;

  // Spätestens 0,9 s nach der ersten ungespeicherten Änderung speichern (nicht bei jeder Änderung neu verzögern)
  useEffect(() => {
    if (saveState !== 'dirty') return;
    const t = setTimeout(save, 900);
    return () => clearTimeout(t);
  }, [saveState, save]);

  // Beim Schließen/Verlassen des Tabs noch einen Speicherversuch senden
  useEffect(() => {
    const onHide = () => {
      const st = useEditor.getState();
      if (st.permission === 'read' || !st.meta || !['dirty', 'error'].includes(st.saveState)) return;
      const body = JSON.stringify({ data: st.doc, version: st.version });
      if (body.length > 60000) return; // keepalive-Anfragen sind auf 64 KB begrenzt
      fetch(`/api/harnesses/${st.meta.id}`, {
        method: 'PUT',
        keepalive: true,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'HarnessDesigner' },
        body,
      }).catch(() => {});
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  useEffect(() => {
    if (saveState !== 'error') return;
    const t = setTimeout(() => {
      useEditor.getState().setSaveState('dirty');
    }, 5000);
    return () => clearTimeout(t);
  }, [saveState]);

  useEffect(() => {
    const onBeforeUnload = (e) => {
      const s = useEditor.getState().saveState;
      if (s !== 'saved') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const flushAndGo = async (to) => {
    for (let i = 0; i < 20 && ['dirty', 'saving'].includes(useEditor.getState().saveState); i++) {
      if (useEditor.getState().saveState === 'dirty') await save();
      else await new Promise((r) => setTimeout(r, 150));
    }
    navigate(to);
  };

  const resolveConflict = async (mode) => {
    if (mode === 'reload') {
      const { harness, permission, breadcrumb } = await api.get(`/harnesses/${id}`);
      useEditor.getState().load(harness, permission, breadcrumb);
    } else {
      const { harness } = await api.get(`/harnesses/${id}`);
      useEditor.getState().setVersion(harness.version);
      useEditor.getState().setSaveState('dirty');
    }
  };

  // ---------- Hilfen ----------
  const openPartPicker = useCallback((category, onPick) => setPicker({ category, onPick }), []);

  const viewCenter = () => {
    const st = useEditor.getState();
    const vp = st.viewports[st.view === 'layout' ? 'layout' : 'schematic'];
    const el = document.querySelector('.ed-canvas');
    const r = el?.getBoundingClientRect() || { width: 800, height: 600 };
    return { x: (r.width / 2 - vp.x) / vp.k, y: (r.height / 2 - vp.y) / vp.k };
  };

  // Bauteil an Position der aktuellen Ansicht anlegen
  const addAt = (kind, pos, opts = {}) => {
    const st = useEditor.getState();
    const v = st.view === 'layout' ? 'layout' : 'schematic';
    if (v === 'layout') return addComponent(kind, freeSchematicSpot(st.doc), { ...opts, layPos: pos });
    return addComponent(kind, pos, opts);
  };

  const addFromLibrary = (category, pos) =>
    openPartPicker(category, (part) => {
      const kind = category === 'device' ? 'device' : category;
      const label = category === 'connector' ? undefined : undefined;
      addAt(kind, pos, { part, label, subtype: part.data?.subtype });
    });

  const addMenuItems = (pos, v) => [
    { title: 'Hinzufügen' },
    { label: 'Steckverbinder …', icon: '⊞', onClick: () => setAddConn({ pos, view: v }) },
    { label: 'Steckverbinder aus Bibliothek …', icon: '📚', onClick: () => addFromLibrary('connector', pos) },
    {
      label: 'Terminal',
      icon: '⊸',
      items: [
        ...TERMINAL_SUBTYPES.map((t) => ({ label: t.label, icon: t.symbol, onClick: () => addAt('terminal', pos, { subtype: t.value }) })),
        { separator: true },
        { label: 'Aus Bibliothek …', icon: '📚', onClick: () => addFromLibrary('terminal', pos) },
      ],
    },
    { label: 'Spleiß', icon: '●', onClick: () => addAt('splice', pos) },
    {
      label: 'Bauelement',
      icon: '▷|',
      items: [
        { label: 'Diode', onClick: () => addAt('device', pos, { subtype: 'diode' }) },
        { label: 'Widerstand', onClick: () => addAt('device', pos, { subtype: 'resistor' }) },
        { separator: true },
        { label: 'Aus Bibliothek …', icon: '📚', onClick: () => addFromLibrary('device', pos) },
      ],
    },
    ...(v === 'layout'
      ? [{ label: 'Abzweigpunkt', icon: '■', onClick: () => useEditor.getState().update((d) => void addNodeAt(d, pos)) }]
      : []),
    { label: 'Notiz', icon: '✎', onClick: () => addNote(v === 'layout' ? 'lay' : 'sch', pos) },
  ];

  const componentMenu = (c, v) => {
    const st = useEditor.getState();
    const others = st.doc.components.filter((x) => x.type === 'connector' && x.id !== c.id);
    const upd = (fn) => st.update((d) => void fn(d.components.find((x) => x.id === c.id), d));
    const category = c.type === 'device' ? 'device' : c.type;
    return [
      { title: c.label },
      {
        label: c.part ? 'Teil ändern …' : 'Teil zuordnen …',
        icon: '📚',
        onClick: () =>
          openPartPicker(category, async (part) => {
            const lost = wiresLostByPart(useEditor.getState().doc, c.id, part);
            if (lost && !(await dialogs.confirm(`Dabei werden ${lost} Leitung(en) an überzähligen Pins gelöscht. Fortfahren?`, { okLabel: 'Zuordnen', danger: true }))) return;
            assignPart(c.id, part);
          }),
      },
      { label: 'Duplizieren', icon: '⧉', onClick: duplicateSelection },
      c.type === 'connector' && {
        label: 'Gegenstück',
        icon: '⇄',
        items: [
          { label: '— nicht gesteckt —', checked: !c.mateId, onClick: () => setMate(c.id, null) },
          ...others.map((o) => ({ label: o.label, checked: c.mateId === o.id, onClick: () => setMate(c.id, o.id) })),
        ],
      },
      ...(v === 'layout' && c.type === 'connector'
        ? [
            { separator: true },
            { label: 'Teilebild anzeigen', icon: '🖼', checked: !!c.show?.image, onClick: () => upd((x) => (x.show = { ...x.show, image: !x.show?.image })) },
            { label: 'Steckgesicht anzeigen', icon: '⠿', checked: !!c.show?.face, onClick: () => upd((x) => (x.show = { ...x.show, face: !x.show?.face })) },
            { label: 'Leitungstabelle anzeigen', icon: '☰', checked: !!c.show?.table, onClick: () => upd((x) => (x.show = { ...x.show, table: !x.show?.table })) },
          ]
        : []),
      { separator: true },
      { label: 'In Stückliste', icon: '≡', checked: !c.excludeFromBom, onClick: () => upd((x) => (x.excludeFromBom = !x.excludeFromBom)) },
      { separator: true },
      { label: 'Löschen', icon: '🗑', danger: true, onClick: deleteSelection },
    ];
  };

  const wireMenu = (w) => {
    const st = useEditor.getState();
    const upd = (fn) => st.update((d) => void fn(d.wires.find((x) => x.id === w.id)));
    return [
      { title: w.label },
      { label: 'Farbe', icon: '◐', items: WIRE_COLORS.map((c) => ({ label: `${c.name} (${c.code})`, checked: w.color === c.code, onClick: () => upd((x) => (x.color = c.code)) })) },
      { label: 'Querschnitt', icon: '⌀', items: CROSS_SECTIONS.map((cs) => ({ label: fmtCs(cs), checked: w.cs === cs, onClick: () => upd((x) => (x.cs = cs)) })) },
      { label: 'Richtung tauschen', icon: '⇆', onClick: () => upd((x) => ([x.from, x.to] = [x.to, x.from])) },
      typeof w.schMid === 'number' && { label: 'Verlauf zurücksetzen', icon: '↺', onClick: () => upd((x) => delete x.schMid) },
      { separator: true },
      { label: 'Löschen', icon: '🗑', danger: true, onClick: deleteSelection },
    ];
  };

  const segmentMenu = (s, world) => {
    const st = useEditor.getState();
    const pts = segmentPoints(s, derived);
    const hit = pts ? nearestOnPolyline(pts, world) : null;
    return [
      { title: `Segment ${derived.nodeLabel(s.a)} – ${derived.nodeLabel(s.b)}` },
      {
        label: 'Länge bearbeiten …',
        icon: '↔',
        onClick: async () => {
          const v = await dialogs.prompt('Segmentlänge', { label: 'Länge in mm', value: s.length ? String(s.length).replace('.', ',') : '' });
          if (v === null) return;
          const n = Number(String(v).replace(',', '.'));
          if (!Number.isFinite(n) || n < 0) return;
          st.update((d) => void (d.segments.find((x) => x.id === s.id).length = n));
        },
      },
      {
        label: 'Ummantelung hinzufügen …',
        icon: '◎',
        onClick: () =>
          openPartPicker('covering', (part) =>
            st.update((d) => {
              const x = d.segments.find((q) => q.id === s.id);
              x.coverings = [...(x.coverings || []), { id: uid('v'), part: snapshotPart(part), label: '' }];
            })
          ),
      },
      hit && {
        label: 'Abzweigpunkt hier einfügen',
        icon: '⊥',
        onClick: () => {
          let node;
          st.update((d) => {
            node = splitSegment(d, s.id, hit, fractionAlong(pts, hit));
          });
          if (node) st.select([{ kind: 'node', id: node.id }]);
        },
      },
      hit && {
        label: 'Knickpunkt hier einfügen',
        icon: '⌐',
        onClick: () =>
          st.update((d) => {
            const x = d.segments.find((q) => q.id === s.id);
            x.points.splice(hit.index, 0, { x: Math.round(hit.point.x), y: Math.round(hit.point.y) });
          }),
      },
      s.points?.length > 0 && { label: 'Knickpunkte entfernen', icon: '—', onClick: () => st.update((d) => void (d.segments.find((x) => x.id === s.id).points = [])) },
      { separator: true },
      { label: 'Löschen', icon: '🗑', danger: true, onClick: deleteSelection },
    ];
  };

  const onContextMenu = (e, world, v) => {
    if (readOnly) return;
    const st = useEditor.getState();
    const el = e.target.closest?.('[data-kind]');
    const kind = el?.dataset.kind;
    const eid = el?.dataset.id;
    let items;
    if (!kind) {
      items = addMenuItems(world, v);
    } else {
      const selKind = kind === 'callout' ? 'component' : kind;
      if (!st.selection.some((s) => s.id === eid)) st.select([{ kind: selKind, id: eid }]);
      if (kind === 'component') items = componentMenu(st.doc.components.find((c) => c.id === eid), v);
      else if (kind === 'callout') {
        const k = el.dataset.callout;
        const upd = (fn) => st.update((d) => void fn(d.components.find((x) => x.id === eid)));
        items = [
          { label: 'Position zurücksetzen', icon: '↺', onClick: () => upd((x) => delete x.callouts[k]) },
          { label: 'Ausblenden', icon: '✕', onClick: () => upd((x) => (x.show = { ...x.show, [k]: false })) },
        ];
      } else if (kind === 'wire') items = wireMenu(st.doc.wires.find((w) => w.id === eid));
      else if (kind === 'segment') items = segmentMenu(st.doc.segments.find((s) => s.id === eid), world);
      else if (kind === 'node')
        items = [
          {
            label: 'Bezeichnung …',
            icon: '✎',
            onClick: async () => {
              const n = st.doc.nodes.find((x) => x.id === eid);
              const v2 = await dialogs.prompt('Abzweigpunkt', { label: 'Bezeichnung', value: n?.label || '' });
              if (v2 !== null) st.update((d) => void (d.nodes.find((x) => x.id === eid).label = v2));
            },
          },
          { label: 'Entfernen', icon: '🗑', danger: true, onClick: () => (st.update((d) => void removeNode(d, eid)), st.clearSelection()) },
        ];
      else if (kind === 'note')
        items = [
          {
            label: 'Bearbeiten …',
            icon: '✎',
            onClick: async () => {
              const n = st.doc.notes.find((x) => x.id === eid);
              const t = await dialogs.prompt('Notiz', { value: n?.text || '', multiline: true });
              if (t !== null) st.update((d) => void (d.notes.find((x) => x.id === eid).text = t));
            },
          },
          { label: 'Löschen', icon: '🗑', danger: true, onClick: deleteSelection },
        ];
    }
    if (items) setCtx({ x: e.clientX, y: e.clientY, items });
  };

  // ---------- Tastatur ----------
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (document.querySelector('.modal-backdrop')) return;
      const st = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z' && !e.shiftKey) {
        e.preventDefault();
        st.undo();
      } else if ((mod && k === 'y') || (mod && k === 'z' && e.shiftKey)) {
        e.preventDefault();
        st.redo();
      } else if (mod && k === 'd') {
        e.preventDefault();
        if (st.permission !== 'read') duplicateSelection();
      } else if (mod && k === 'a') {
        e.preventDefault();
        const items =
          st.view === 'layout'
            ? [...st.doc.components.map((c) => ({ kind: 'component', id: c.id })), ...st.doc.nodes.map((n) => ({ kind: 'node', id: n.id }))]
            : st.doc.components.map((c) => ({ kind: 'component', id: c.id }));
        st.select(items);
      } else if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) {
        if (st.permission !== 'read' && st.selection.length) {
          e.preventDefault();
          deleteSelection();
        }
      } else if (e.key === 'Escape') {
        st.clearSelection();
      } else if (!mod && k === 'f') {
        setFitSignal((n) => n + 1);
      } else if (!mod && k === '1') st.setView('schematic');
      else if (!mod && k === '2') st.setView('layout');
      else if (!mod && k === '3') st.setView('tables');
      else if (!mod && k === 'v' && st.view === 'layout') st.setLayoutTool('select');
      else if (!mod && k === 's' && st.view === 'layout' && st.permission !== 'read') st.setLayoutTool('segment');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---------- Export ----------
  const doExcel = async () => {
    try {
      await exportExcel({ doc, derived, meta, author: user.displayName });
    } catch (e) {
      dialogs.alert(`Excel-Export fehlgeschlagen: ${e.message}`);
    }
  };
  const doImage = async ({ view: v, format, theme, scale }) => {
    const name = `${meta.name} – ${v === 'schematic' ? 'Schaltplan' : 'Layout'}`;
    const opts = { view: v, doc, derived, themeName: theme, title: name };
    try {
      if (format === 'svg') await exportSvg(opts, name);
      else await exportPng(opts, name, scale);
      setImageDlg(false);
    } catch (e) {
      dialogs.alert(`Bildexport fehlgeschlagen: ${e.message}`);
    }
  };

  const saveSettings = async ({ name, description, settings }) => {
    try {
      if (name !== meta.name || description !== (meta.description || '')) {
        await api.patch(`/harnesses/${meta.id}`, { name, description });
        useEditor.getState().setMeta({ name, description });
      }
      useEditor.getState().update((d) => {
        d.settings = { ...d.settings, ...settings };
      });
      setShowSettings(false);
    } catch (e) {
      dialogs.alert(e.message);
    }
  };

  // ---------- Rendering ----------
  if (loadError) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h2>Kabelbaum nicht verfügbar</h2>
          <div className="error-box">{loadError}</div>
          <Link to="/">Zur Projektübersicht</Link>
        </div>
      </div>
    );
  }
  if (!doc || !meta || String(meta.id) !== String(id) || !derived) return <div className="auth-wrap muted">Lade Kabelbaum …</div>;

  const project = meta.breadcrumb?.[meta.breadcrumb.length - 1];
  const saveLabel = {
    saved: 'Gespeichert',
    dirty: 'Ungespeichert …',
    saving: 'Speichert …',
    error: `Fehler beim Speichern – neuer Versuch …`,
    conflict: 'Konflikt',
  }[saveState];

  return (
    <div className="editor">
      <header className="ed-top">
        <a
          href="/"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            flushAndGo(project ? `/project/${project.id}` : '/');
          }}
          title="Zurück zum Projekt"
        >
          <img src="/favicon.svg" alt="" />
        </a>
        <div className="ed-crumbs">
          {meta.breadcrumb?.map((b) => (
            <span key={b.id} className="row" style={{ gap: 6 }}>
              <a
                href={`/project/${b.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  flushAndGo(`/project/${b.id}`);
                }}
              >
                {b.name}
              </a>
              <span>›</span>
            </span>
          ))}
          <span className="cur" title={meta.description || ''}>
            {meta.name}
          </span>
          {readOnly && <span className="badge accent">Nur lesen</span>}
        </div>
        <div className="spacer" />
        <div className="seg-tabs">
          <button className={view === 'schematic' ? 'on' : ''} onClick={() => setView('schematic')} title="Schaltplan (1)">
            Schaltplan
          </button>
          <button className={view === 'layout' ? 'on' : ''} onClick={() => setView('layout')} title="Layout (2)">
            Layout
          </button>
          <button className={view === 'tables' ? 'on' : ''} onClick={() => setView('tables')} title="Listen (3)">
            Listen
          </button>
        </div>
        <div className="spacer" />
        <span className={`save-state ${saveState === 'error' || saveState === 'conflict' ? 'err' : ''}`} title={saveError}>
          {!readOnly && saveLabel}
        </span>
        {!readOnly && (
          <>
            <button className="icon ghost" disabled={!canUndo} onClick={() => useEditor.getState().undo()} title="Rückgängig (Strg+Z)">
              ↶
            </button>
            <button className="icon ghost" disabled={!canRedo} onClick={() => useEditor.getState().redo()} title="Wiederholen (Strg+Y)">
              ↷
            </button>
          </>
        )}
        <Dropdown label="⇩ Export" buttonClass="">
          <MenuButton icon="🖨" onClick={() => setPrintDlg(true)}>
            Drucken / PDF …
          </MenuButton>
          <MenuButton icon="🖼" onClick={() => setImageDlg(true)}>
            Als Bild (PNG/SVG) …
          </MenuButton>
          <MenuButton icon="▦" onClick={doExcel}>
            Excel-Liste (.xlsx)
          </MenuButton>
        </Dropdown>
        <button className="icon" onClick={() => setShowSettings(true)} title="Kabelbaum-Einstellungen">
          ⚙
        </button>
      </header>

      {saveState === 'conflict' && (
        <div className="warn-box" style={{ borderRadius: 0, display: 'flex', gap: 10, alignItems: 'center' }}>
          <span className="grow">{saveError} Deine letzten Änderungen sind noch nicht gespeichert.</span>
          <button className="small" onClick={() => resolveConflict('reload')}>
            Neu laden (meine Änderungen verwerfen)
          </button>
          <button className="small" onClick={() => resolveConflict('overwrite')}>
            Meine Version speichern
          </button>
        </div>
      )}

      <div className="ed-body">
        {view !== 'tables' && !readOnly && (
          <div className="ed-palette">
            <button title="Steckverbinder" onClick={() => setAddConn({ pos: viewCenter(), view })}>
              ⊞
            </button>
            <button title="Steckverbinder aus Bibliothek" onClick={() => addFromLibrary('connector', viewCenter())}>
              📚
            </button>
            <button title="Terminal (Ringkabelschuh)" onClick={() => addAt('terminal', viewCenter(), { subtype: 'ring' })}>
              ⊸
            </button>
            <button title="Spleiß" onClick={() => addAt('splice', viewCenter())}>
              ●
            </button>
            <button title="Diode" onClick={() => addAt('device', viewCenter(), { subtype: 'diode' })} style={{ fontSize: 12 }}>
              ▷|
            </button>
            <button title="Widerstand" onClick={() => addAt('device', viewCenter(), { subtype: 'resistor' })}>
              ▭
            </button>
            <button title="Notiz" onClick={() => addNote(view === 'layout' ? 'lay' : 'sch', viewCenter())}>
              ✎
            </button>
            <div className="sep" />
            <button title="Ansicht einpassen (F)" onClick={() => setFitSignal((n) => n + 1)}>
              ⤢
            </button>
          </div>
        )}
        {view === 'schematic' && <SchematicView derived={derived} onContextMenu={onContextMenu} fitSignal={fitSignal} />}
        {view === 'layout' && <LayoutView derived={derived} onContextMenu={onContextMenu} fitSignal={fitSignal} />}
        {view === 'tables' && <TablesView derived={derived} />}
        <aside className="ed-inspector">
          <Inspector derived={derived} openPartPicker={openPartPicker} />
        </aside>
      </div>

      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctx.items} onClose={() => setCtx(null)} />}
      {picker && (
        <PartPicker
          category={picker.category}
          title={`${CATEGORY_SINGULAR[picker.category]} aus Bibliothek wählen`}
          onClose={() => setPicker(null)}
          onPick={(part) => {
            setPicker(null);
            picker.onPick(part);
          }}
        />
      )}
      {addConn && (
        <AddConnectorDialog
          onClose={() => setAddConn(null)}
          onCreate={(opts) => {
            const pos = addConn.pos;
            setAddConn(null);
            addAt('connector', pos, opts);
          }}
          onPickFromLibrary={() => {
            const pos = addConn.pos;
            setAddConn(null);
            addFromLibrary('connector', pos);
          }}
        />
      )}
      {showSettings && (
        <SettingsDialog meta={meta} settings={doc.settings} readOnly={readOnly} onClose={() => setShowSettings(false)} onSave={saveSettings} />
      )}
      {printDlg && (
        <PrintDialog
          onClose={() => setPrintDlg(false)}
          onPrint={(job) => {
            setPrintDlg(false);
            setPrintJob(job);
          }}
        />
      )}
      {printJob && <PrintView job={printJob} doc={doc} derived={derived} meta={meta} author={user.displayName} onDone={() => setPrintJob(null)} />}
      {imageDlg && <ImageDialog defaultView={view} onClose={() => setImageDlg(false)} onExport={doImage} />}
    </div>
  );
}
