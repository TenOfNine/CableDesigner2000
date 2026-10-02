import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { ContextMenu, Dropdown, MenuButton, useDialogs } from '../components/ui.jsx';
import { PartPicker } from '../components/parts.jsx';
import { useEditor } from './store.js';
import { derive } from './derive.js';
import SchematicView from './SchematicView.jsx';
import { schematicBounds } from './SchematicScene.jsx';
import LayoutView from './LayoutView.jsx';
import TablesView from './TablesView.jsx';
import Inspector from './Inspector.jsx';
import PrintView from './PrintView.jsx';
import { RevisionsDialog } from './revisions.jsx';
import { AddConnectorDialog, SettingsDialog, PrintDialog, ImageDialog, HarnessPickerDialog, GroupWiresDialog } from './dialogs.jsx';
import { exportExcel, exportPng, exportSvg } from './exports.jsx';
import {
  addComponent, addNote, deleteSelection, duplicateSelection, assignPart, setMate, removeNode, splitSegment,
  freeSchematicSpot, wiresLostByPart, addNodeAt, groupWires, setWireCable,
} from './actions.js';
import { terminalSubtypes, WIRE_COLORS, CROSS_SECTIONS, fmtCs, uid, snapshotPart, categorySingular, colorByCode, cableKindLabel } from './model.js';
import { segmentPoints, nearestOnPolyline, fractionAlong } from './geometry.js';
import { t } from '../i18n/index.js';

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
  const embeds = useEditor((s) => s.embeds);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const readOnly = permission === 'read';

  const [ctx, setCtx] = useState(null);
  const [picker, setPicker] = useState(null); // { category, onPick }
  const [addConn, setAddConn] = useState(null); // { pos, view }
  const [embedAt, setEmbedAt] = useState(null); // position for a new sub-harness
  const [groupDlg, setGroupDlg] = useState(null); // { wireIds, kind }
  const [showSettings, setShowSettings] = useState(false);
  const [showRevisions, setShowRevisions] = useState(false);
  const [printDlg, setPrintDlg] = useState(false);
  const [printJob, setPrintJob] = useState(null);
  const [imageDlg, setImageDlg] = useState(false);
  const [fitSignal, setFitSignal] = useState(0);

  // ---------- Loading ----------
  const loadEmbeds = useCallback(async () => {
    try {
      const { harnesses } = await api.get(`/harnesses/${id}/embeds`);
      useEditor.getState().setEmbeds(new Map(harnesses.map((h) => [Number(h.id), h])));
    } catch {
      useEditor.getState().setEmbeds(new Map());
    }
  }, [id]);

  const loadHarness = useCallback(async () => {
    const { harness, permission: perm, breadcrumb } = await api.get(`/harnesses/${id}`);
    useEditor.getState().load(harness, perm, breadcrumb);
    await loadEmbeds();
  }, [id, loadEmbeds]);

  useEffect(() => {
    let alive = true;
    setLoadError('');
    useEditor.getState().setEmbeds(new Map());
    loadHarness().catch((e) => alive && setLoadError(e.message));
    return () => {
      alive = false;
    };
  }, [loadHarness]);

  const derived = useMemo(() => (doc ? derive(doc, embeds) : null), [doc, embeds]);

  // ---------- Saving ----------
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
      // pick up changes made while saving
      if (useEditor.getState().saveState === 'dirty') setTimeout(() => saveRef.current?.(), 300);
    }
  }, [id]);
  const saveRef = useRef(save);
  saveRef.current = save;

  // save at the latest 0.9 s after the first unsaved change (not re-delayed by every change)
  useEffect(() => {
    if (saveState !== 'dirty') return;
    const timer = setTimeout(save, 900);
    return () => clearTimeout(timer);
  }, [saveState, save]);

  useEffect(() => {
    if (saveState !== 'error') return;
    const timer = setTimeout(() => useEditor.getState().setSaveState('dirty'), 5000);
    return () => clearTimeout(timer);
  }, [saveState]);

  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (useEditor.getState().saveState !== 'saved') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // last save attempt when the tab is closed
  useEffect(() => {
    const onHide = () => {
      const st = useEditor.getState();
      if (st.permission === 'read' || !st.meta || !['dirty', 'error'].includes(st.saveState)) return;
      const body = JSON.stringify({ data: st.doc, version: st.version });
      if (body.length > 60000) return; // keepalive requests are limited to 64 KB
      fetch(`/api/harnesses/${st.meta.id}`, {
        method: 'PUT',
        keepalive: true,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'CableDesigner2000' },
        body,
      }).catch(() => {});
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  /** Waits until everything is saved */
  const flush = useCallback(async () => {
    for (let i = 0; i < 40 && ['dirty', 'saving'].includes(useEditor.getState().saveState); i++) {
      if (useEditor.getState().saveState === 'dirty' && !saving.current) await save();
      else await new Promise((r) => setTimeout(r, 150));
    }
  }, [save]);

  const flushAndGo = async (to) => {
    await flush();
    navigate(to);
  };

  const resolveConflict = async (mode) => {
    if (mode === 'reload') await loadHarness();
    else {
      const { harness } = await api.get(`/harnesses/${id}`);
      useEditor.getState().setVersion(harness.version);
      useEditor.getState().setSaveState('dirty');
    }
  };

  // ---------- Helpers ----------
  const openPartPicker = useCallback((category, onPick) => setPicker({ category, onPick }), []);

  const viewCenter = () => {
    const st = useEditor.getState();
    const vp = st.viewports[st.view === 'layout' ? 'layout' : 'schematic'];
    const el = document.querySelector('.ed-canvas');
    const r = el?.getBoundingClientRect() || { width: 800, height: 600 };
    return { x: (r.width / 2 - vp.x) / vp.k, y: (r.height / 2 - vp.y) / vp.k };
  };

  // Creates a component at a position in the current view
  const addAt = (kind, pos, opts = {}) => {
    const st = useEditor.getState();
    if (st.view === 'layout') return addComponent(kind, freeSchematicSpot(st.doc), { ...opts, layPos: pos });
    return addComponent(kind, pos, opts);
  };

  const addFromLibrary = (category, pos) =>
    openPartPicker(category, (part) => addAt(category === 'device' ? 'device' : category, pos, { part, subtype: part.data?.subtype }));

  const embedHarness = async (h, pos) => {
    setEmbedAt(null);
    // The block size is only known once the embedded harness is loaded, so it goes to the right of the existing schematic
    const st = useEditor.getState();
    const opts = { harnessId: h.id, harnessName: h.name };
    if (st.doc.components.length) {
      const b = schematicBounds(st.doc, derived);
      opts.schPos = { x: b.x + b.w + 40, y: b.y + 20 };
    }
    addAt('subharness', pos, opts);
    await flush();
    await loadEmbeds();
  };

  const addMenuItems = (pos, v) => [
    { title: t('Add') },
    { label: t('Connector …'), icon: '⊞', onClick: () => setAddConn({ pos, view: v }) },
    { label: t('Connector from library …'), icon: '📚', onClick: () => addFromLibrary('connector', pos) },
    {
      label: t('Terminal'),
      icon: '⊸',
      items: [
        ...terminalSubtypes().map((ts) => ({ label: ts.label, icon: ts.symbol, onClick: () => addAt('terminal', pos, { subtype: ts.value }) })),
        { separator: true },
        { label: t('From library …'), icon: '📚', onClick: () => addFromLibrary('terminal', pos) },
      ],
    },
    { label: t('Splice'), icon: '●', onClick: () => addAt('splice', pos) },
    {
      label: t('Device'),
      icon: '▷|',
      items: [
        { label: t('Diode'), onClick: () => addAt('device', pos, { subtype: 'diode' }) },
        { label: t('Resistor'), onClick: () => addAt('device', pos, { subtype: 'resistor' }) },
        { separator: true },
        { label: t('From library …'), icon: '📚', onClick: () => addFromLibrary('device', pos) },
      ],
    },
    { label: t('Embed sub-harness …'), icon: '⧉', onClick: () => setEmbedAt(pos) },
    ...(v === 'layout' ? [{ label: t('Branch point'), icon: '■', onClick: () => useEditor.getState().update((d) => void addNodeAt(d, pos)) }] : []),
    { label: t('Note'), icon: '✎', onClick: () => addNote(v === 'layout' ? 'lay' : 'sch', pos) },
  ];

  const componentMenu = (c, v) => {
    const st = useEditor.getState();
    const upd = (fn) => st.update((d) => void fn(d.components.find((x) => x.id === c.id), d));
    if (c.type === 'subharness') {
      return [
        { title: c.label },
        { label: t('Open harness'), icon: '↗', onClick: () => flushAndGo(`/harness/${c.ref?.harnessId}`) },
        { label: t('Reload'), icon: '↻', onClick: loadEmbeds },
        { separator: true },
        { label: t('Remove'), icon: '🗑', danger: true, onClick: deleteSelection },
      ];
    }
    const others = derived.allConnectors.filter((x) => x.id !== c.id);
    const category = c.type === 'device' ? 'device' : c.type;
    return [
      { title: c.label },
      {
        label: c.part ? t('Change part …') : t('Assign part …'),
        icon: '📚',
        onClick: () =>
          openPartPicker(category, async (part) => {
            const lost = wiresLostByPart(useEditor.getState().doc, c.id, part);
            if (lost && !(await dialogs.confirm(t('{n} wire(s) on surplus pins will be deleted. Continue?', { n: lost }), { okLabel: t('Assign'), danger: true }))) return;
            assignPart(c.id, part);
          }),
      },
      { label: t('Duplicate'), icon: '⧉', onClick: duplicateSelection },
      c.type === 'connector' && {
        label: t('Mating part'),
        icon: '⇄',
        items: [
          { label: t('— not mated —'), checked: !c.mateId, onClick: () => setMate(c.id, null) },
          ...others.map((o) => ({ label: o.label, checked: c.mateId === o.id, onClick: () => setMate(c.id, o.id) })),
        ],
      },
      ...(v === 'layout' && c.type === 'connector'
        ? [
            { separator: true },
            { label: t('Show part image'), icon: '🖼', checked: !!c.show?.image, onClick: () => upd((x) => (x.show = { ...x.show, image: !x.show?.image })) },
            { label: t('Show mating face'), icon: '⠿', checked: !!c.show?.face, onClick: () => upd((x) => (x.show = { ...x.show, face: !x.show?.face })) },
            { label: t('Show wire table'), icon: '☰', checked: !!c.show?.table, onClick: () => upd((x) => (x.show = { ...x.show, table: !x.show?.table })) },
          ]
        : []),
      { separator: true },
      { label: t('In bill of materials'), icon: '≡', checked: !c.excludeFromBom, onClick: () => upd((x) => (x.excludeFromBom = !x.excludeFromBom)) },
      ['connector', 'terminal', 'splice'].includes(c.type) && {
        label: t('Interface (for embedding)'),
        icon: '⧉',
        checked: !!c.interface,
        onClick: () => upd((x) => (x.interface = !x.interface)),
      },
      { separator: true },
      { label: t('Delete'), icon: '🗑', danger: true, onClick: deleteSelection },
    ];
  };

  const wireMenu = (w) => {
    const st = useEditor.getState();
    const upd = (fn) => st.update((d) => void fn(d.wires.find((x) => x.id === w.id)));
    const selWires = st.selection.filter((s) => s.kind === 'wire').map((s) => s.id);
    const cables = st.doc.cables || [];
    return [
      { title: selWires.length > 1 ? t('{n} wires', { n: selWires.length }) : w.label },
      selWires.length > 1 && { label: t('Combine into multi-core cable …'), icon: '◎', onClick: () => setGroupDlg({ wireIds: selWires, kind: 'cable' }) },
      selWires.length > 1 && { label: t('Twist …'), icon: '⟲', onClick: () => setGroupDlg({ wireIds: selWires, kind: 'twist' }) },
      selWires.length > 1 && { separator: true },
      {
        label: t('Colour'),
        icon: '◐',
        items: WIRE_COLORS.map((c) => ({ label: `${colorByCode(c.code).name} (${c.code})`, checked: w.color === c.code, onClick: () => upd((x) => (x.color = c.code)) })),
      },
      { label: t('Cross-section'), icon: '⌀', items: CROSS_SECTIONS.map((cs) => ({ label: fmtCs(cs), checked: w.cs === cs, onClick: () => upd((x) => (x.cs = cs)) })) },
      {
        label: t('Cable / twist'),
        icon: '◎',
        items: [
          { label: t('— none —'), checked: !w.cableId, onClick: () => setWireCable(w.id, null) },
          ...cables.map((k) => ({ label: `${k.label} (${cableKindLabel(k.kind)})`, checked: w.cableId === k.id, onClick: () => setWireCable(w.id, k.id) })),
        ],
      },
      { label: t('Swap direction'), icon: '⇆', onClick: () => upd((x) => ([x.from, x.to] = [x.to, x.from])) },
      typeof w.schMid === 'number' && { label: t('Reset path'), icon: '↺', onClick: () => upd((x) => delete x.schMid) },
      { separator: true },
      { label: t('Delete'), icon: '🗑', danger: true, onClick: deleteSelection },
    ];
  };

  const segmentMenu = (s, world) => {
    const st = useEditor.getState();
    const pts = segmentPoints(s, derived);
    const hit = pts ? nearestOnPolyline(pts, world) : null;
    return [
      { title: t('Segment {a} – {b}', { a: derived.nodeLabel(s.a), b: derived.nodeLabel(s.b) }) },
      {
        label: t('Edit length …'),
        icon: '↔',
        onClick: async () => {
          const v = await dialogs.prompt(t('Segment length'), { label: t('Length in mm'), value: s.length ? String(s.length) : '' });
          if (v === null) return;
          const n = Number(String(v).replace(',', '.'));
          if (!Number.isFinite(n) || n < 0) return;
          st.update((d) => void (d.segments.find((x) => x.id === s.id).length = n));
        },
      },
      {
        label: t('Add covering …'),
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
        label: t('Insert branch point here'),
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
        label: t('Insert bend point here'),
        icon: '⌐',
        onClick: () =>
          st.update((d) => {
            const x = d.segments.find((q) => q.id === s.id);
            x.points.splice(hit.index, 0, { x: Math.round(hit.point.x), y: Math.round(hit.point.y) });
          }),
      },
      s.points?.length > 0 && { label: t('Remove bend points'), icon: '—', onClick: () => st.update((d) => void (d.segments.find((x) => x.id === s.id).points = [])) },
      { separator: true },
      { label: t('Delete'), icon: '🗑', danger: true, onClick: deleteSelection },
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
          { label: t('Reset position'), icon: '↺', onClick: () => upd((x) => delete x.callouts[k]) },
          { label: t('Hide'), icon: '✕', onClick: () => upd((x) => (x.show = { ...x.show, [k]: false })) },
        ];
      } else if (kind === 'wire') items = wireMenu(st.doc.wires.find((w) => w.id === eid));
      else if (kind === 'cable') items = [{ label: t('Dissolve group'), icon: '✕', danger: true, onClick: deleteSelection }];
      else if (kind === 'segment') items = segmentMenu(st.doc.segments.find((s) => s.id === eid), world);
      else if (kind === 'node')
        items = [
          {
            label: t('Designation …'),
            icon: '✎',
            onClick: async () => {
              const n = st.doc.nodes.find((x) => x.id === eid);
              const v2 = await dialogs.prompt(t('Branch point'), { label: t('Designation'), value: n?.label || '' });
              if (v2 !== null) st.update((d) => void (d.nodes.find((x) => x.id === eid).label = v2));
            },
          },
          { label: t('Remove'), icon: '🗑', danger: true, onClick: () => (st.update((d) => void removeNode(d, eid)), st.clearSelection()) },
        ];
      else if (kind === 'note')
        items = [
          {
            label: t('Edit …'),
            icon: '✎',
            onClick: async () => {
              const n = st.doc.notes.find((x) => x.id === eid);
              const text = await dialogs.prompt(t('Note'), { value: n?.text || '', multiline: true });
              if (text !== null) st.update((d) => void (d.notes.find((x) => x.id === eid).text = text));
            },
          },
          { label: t('Delete'), icon: '🗑', danger: true, onClick: deleteSelection },
        ];
    }
    if (items) setCtx({ x: e.clientX, y: e.clientY, items });
  };

  // ---------- Keyboard ----------
  useEffect(() => {
    const onKey = (e) => {
      const tg = e.target;
      if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT' || tg.isContentEditable)) return;
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
      } else if (e.key === 'Escape') st.clearSelection();
      else if (!mod && k === 'f') setFitSignal((n) => n + 1);
      else if (!mod && k === '1') st.setView('schematic');
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
      dialogs.alert(t('Excel export failed: {msg}', { msg: e.message }));
    }
  };
  const doImage = async ({ view: v, format, theme, scale }) => {
    const name = `${meta.name} – ${v === 'schematic' ? t('Schematic') : t('Layout')}`;
    const opts = { view: v, doc, derived, themeName: theme, title: name };
    try {
      if (format === 'svg') await exportSvg(opts, name);
      else await exportPng(opts, name, scale);
      setImageDlg(false);
    } catch (e) {
      dialogs.alert(t('Image export failed: {msg}', { msg: e.message }));
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
          <h2>{t('Harness not available')}</h2>
          <div className="error-box">{loadError}</div>
          <Link to="/">{t('To the project overview')}</Link>
        </div>
      </div>
    );
  }
  if (!doc || !meta || String(meta.id) !== String(id) || !derived) return <div className="auth-wrap muted">{t('Loading harness …')}</div>;

  const project = meta.breadcrumb?.[meta.breadcrumb.length - 1];
  const saveLabel = {
    saved: t('Saved'),
    dirty: t('Unsaved …'),
    saving: t('Saving …'),
    error: t('Error while saving – retrying …'),
    conflict: t('Conflict'),
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
          title={t('Back to the project')}
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
          {readOnly && <span className="badge accent">{t('Read only')}</span>}
        </div>
        <div className="spacer" />
        <div className="seg-tabs">
          <button className={view === 'schematic' ? 'on' : ''} onClick={() => setView('schematic')} title={`${t('Schematic')} (1)`}>
            {t('Schematic')}
          </button>
          <button className={view === 'layout' ? 'on' : ''} onClick={() => setView('layout')} title={`${t('Layout')} (2)`}>
            {t('Layout')}
          </button>
          <button className={view === 'tables' ? 'on' : ''} onClick={() => setView('tables')} title={`${t('Lists')} (3)`}>
            {t('Lists')}
          </button>
        </div>
        <div className="spacer" />
        <span className={`save-state ${saveState === 'error' || saveState === 'conflict' ? 'err' : ''}`} title={saveError}>
          {!readOnly && saveLabel}
        </span>
        {!readOnly && (
          <>
            <button className="icon ghost" disabled={!canUndo} onClick={() => useEditor.getState().undo()} title={t('Undo (Ctrl+Z)')}>
              ↶
            </button>
            <button className="icon ghost" disabled={!canRedo} onClick={() => useEditor.getState().redo()} title={t('Redo (Ctrl+Y)')}>
              ↷
            </button>
          </>
        )}
        <button className="icon" onClick={() => setShowRevisions(true)} title={t('Revision history')}>
          🕘
        </button>
        <Dropdown label={`⇩ ${t('Export')}`}>
          <MenuButton icon="🖨" onClick={() => setPrintDlg(true)}>
            {t('Print / PDF …')}
          </MenuButton>
          <MenuButton icon="🖼" onClick={() => setImageDlg(true)}>
            {t('As image (PNG/SVG) …')}
          </MenuButton>
          <MenuButton icon="▦" onClick={doExcel}>
            {t('Excel list (.xlsx)')}
          </MenuButton>
        </Dropdown>
        <button className="icon" onClick={() => setShowSettings(true)} title={t('Harness settings')}>
          ⚙
        </button>
      </header>

      {saveState === 'conflict' && (
        <div className="warn-box" style={{ borderRadius: 0, display: 'flex', gap: 10, alignItems: 'center' }}>
          <span className="grow">
            {saveError} {t('Your latest changes are not saved yet.')}
          </span>
          <button className="small" onClick={() => resolveConflict('reload')}>
            {t('Reload (discard my changes)')}
          </button>
          <button className="small" onClick={() => resolveConflict('overwrite')}>
            {t('Save my version')}
          </button>
        </div>
      )}

      <div className="ed-body">
        {view !== 'tables' && !readOnly && (
          <div className="ed-palette">
            <button title={t('Connector')} onClick={() => setAddConn({ pos: viewCenter(), view })}>
              ⊞
            </button>
            <button title={t('Connector from library')} onClick={() => addFromLibrary('connector', viewCenter())}>
              📚
            </button>
            <button title={t('Terminal (ring terminal)')} onClick={() => addAt('terminal', viewCenter(), { subtype: 'ring' })}>
              ⊸
            </button>
            <button title={t('Splice')} onClick={() => addAt('splice', viewCenter())}>
              ●
            </button>
            <button title={t('Diode')} onClick={() => addAt('device', viewCenter(), { subtype: 'diode' })} style={{ fontSize: 12 }}>
              ▷|
            </button>
            <button title={t('Resistor')} onClick={() => addAt('device', viewCenter(), { subtype: 'resistor' })}>
              ▭
            </button>
            <button title={t('Embed sub-harness')} onClick={() => setEmbedAt(viewCenter())}>
              ⧉
            </button>
            <button title={t('Note')} onClick={() => addNote(view === 'layout' ? 'lay' : 'sch', viewCenter())}>
              ✎
            </button>
            <div className="sep" />
            <button title={t('Fit view (F)')} onClick={() => setFitSignal((n) => n + 1)}>
              ⤢
            </button>
          </div>
        )}
        {view === 'schematic' && <SchematicView derived={derived} onContextMenu={onContextMenu} fitSignal={fitSignal} />}
        {view === 'layout' && <LayoutView derived={derived} onContextMenu={onContextMenu} fitSignal={fitSignal} />}
        {view === 'tables' && <TablesView derived={derived} />}
        <aside className="ed-inspector">
          <Inspector
            derived={derived}
            openPartPicker={openPartPicker}
            onOpenHarness={(hid) => hid && flushAndGo(`/harness/${hid}`)}
            onReloadEmbeds={loadEmbeds}
          />
        </aside>
      </div>

      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctx.items} onClose={() => setCtx(null)} />}
      {picker && (
        <PartPicker
          category={picker.category}
          title={t('Choose {what} from library', { what: categorySingular(picker.category) })}
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
      {embedAt && <HarnessPickerDialog currentId={meta.id} onClose={() => setEmbedAt(null)} onPick={(h) => embedHarness(h, embedAt)} />}
      {groupDlg && (
        <GroupWiresDialog
          count={groupDlg.wireIds.length}
          kind={groupDlg.kind}
          onClose={() => setGroupDlg(null)}
          onCreate={({ kind, part, applyColors }) => {
            groupWires(groupDlg.wireIds, kind, part, applyColors);
            setGroupDlg(null);
          }}
        />
      )}
      {showSettings && <SettingsDialog meta={meta} settings={doc.settings} readOnly={readOnly} onClose={() => setShowSettings(false)} onSave={saveSettings} />}
      {showRevisions && (
        <RevisionsDialog
          harnessId={meta.id}
          doc={doc}
          readOnly={readOnly}
          flush={flush}
          setRevisionInDoc={(name) => useEditor.getState().update((d) => void (d.settings.revision = name))}
          onRestored={loadHarness}
          onClose={() => setShowRevisions(false)}
        />
      )}
      {printDlg && (
        <PrintDialog
          doc={doc}
          derived={derived}
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
