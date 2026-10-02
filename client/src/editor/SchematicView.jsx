import { useEffect, useRef, useState } from 'react';
import Canvas, { startDrag } from './Canvas.jsx';
import SchematicScene, { computeWireGeometry, schematicBounds, noteSize } from './SchematicScene.jsx';
import { useEditor, isSelected } from './store.js';
import { DARK } from './theme.js';
import { schBox, schAnchor, snap, SCH } from './geometry.js';
import { connectPins } from './actions.js';
import { t } from '../i18n/index.js';

export default function SchematicView({ derived, onContextMenu, fitSignal }) {
  const canvasRef = useRef(null);
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const hover = useEditor((s) => s.hover);
  const readOnly = useEditor((s) => s.permission === 'read');
  const [preview, setPreview] = useState(null);
  const [box, setBox] = useState(null);
  const fitted = useRef(false);

  const fit = () => canvasRef.current?.fit(schematicBounds(useEditor.getState().doc, derived));
  useEffect(() => {
    if (!fitted.current && doc.components.length) {
      fitted.current = true;
      requestAnimationFrame(fit);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (fitSignal) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSignal]);

  const toWorldEv = (ev) => canvasRef.current.toWorld(ev.clientX, ev.clientY);

  const onPointerDown = (e, world, info) => {
    if (e.button !== 0) return;
    const st = useEditor.getState();
    if (info.background) {
      if (info.click) {
        if (!e.shiftKey) st.clearSelection();
        return;
      }
      if (e.shiftKey) startBoxSelect(e, world);
      return;
    }
    const el = e.target;
    const pinEl = el.closest?.('[data-role="pin"]');
    if (pinEl && !readOnly) {
      startConnect(e, pinEl.dataset.comp, pinEl.dataset.pin, world);
      return;
    }
    const kindEl = el.closest?.('[data-kind]');
    if (!kindEl) return;
    const kind = kindEl.dataset.kind;
    const id = kindEl.dataset.id;
    if (kind === 'component' || kind === 'note') startMove(e, kind, id, world);
    else if (kind === 'cable') {
      if (e.shiftKey) st.select([{ kind, id }], true);
      else st.select([{ kind, id }]);
    } else if (kind === 'wire') {
      const sel = st.selection;
      const already = sel.length === 1 && sel[0].id === id;
      if (e.shiftKey) st.select([{ kind, id }], true);
      else st.select([{ kind, id }]);
      if (already && !readOnly) startWireMidDrag(e, id);
    }
  };

  function startMove(e, kind, id, world) {
    const st = useEditor.getState();
    const wasSelected = isSelected(st.selection, kind, id);
    let sel = st.selection;
    if (e.shiftKey) {
      st.select([{ kind, id }], true);
      return;
    }
    if (!wasSelected) {
      sel = [{ kind, id }];
      st.select(sel);
    }
    if (readOnly) return;
    const baseDoc = useEditor.getState().doc;
    const compStarts = new Map();
    const noteStarts = new Map();
    for (const s of sel) {
      if (s.kind === 'component') {
        const c = baseDoc.components.find((x) => x.id === s.id);
        if (c) compStarts.set(c.id, c.sch);
      } else if (s.kind === 'note') {
        const n = baseDoc.notes.find((x) => x.id === s.id);
        if (n) noteStarts.set(n.id, { x: n.x, y: n.y });
      }
    }
    let first = true;
    startDrag(e, {
      onMove: (ev) => {
        if (first) {
          useEditor.getState().checkpoint();
          first = false;
        }
        const w = toWorldEv(ev);
        const dx = w.x - world.x;
        const dy = w.y - world.y;
        const cur = useEditor.getState().doc;
        useEditor.getState().replaceDoc({
          ...cur,
          components: cur.components.map((c) =>
            compStarts.has(c.id) ? { ...c, sch: { x: snap(compStarts.get(c.id).x + dx), y: snap(compStarts.get(c.id).y + dy) } } : c
          ),
          notes: cur.notes.map((n) =>
            noteStarts.has(n.id) ? { ...n, x: snap(noteStarts.get(n.id).x + dx), y: snap(noteStarts.get(n.id).y + dy) } : n
          ),
        });
      },
      onEnd: (ev, started) => {
        if (!started && wasSelected && sel.length > 1) useEditor.getState().select([{ kind, id }]);
      },
    });
  }

  function startConnect(e, compId, pinId, world) {
    const comp = derived.comps.get(compId);
    const idx = comp.pins.findIndex((p) => p.id === pinId);
    const a = schAnchor(comp, idx, world.x);
    setPreview({ a, b: world });
    startDrag(e, {
      threshold: 0,
      onMove: (ev) => setPreview({ a, b: toWorldEv(ev) }),
      onEnd: (ev) => {
        setPreview(null);
        const target = document.elementFromPoint(ev.clientX, ev.clientY);
        const to = resolvePinTarget(target, toWorldEv(ev));
        if (to && to.p !== pinId) connectPins({ c: compId, p: pinId, fn: comp.pins[idx]?.fn }, { ...to, fn: derived.pins.get(to.p)?.pin.fn });
      },
    });
  }

  function resolvePinTarget(target, w) {
    if (!target?.closest) return null;
    const pe = target.closest('[data-role="pin"]');
    if (pe) return { c: pe.dataset.comp, p: pe.dataset.pin };
    const ce = target.closest('[data-kind="component"]');
    if (!ce) return null;
    let c = derived.comps.get(ce.dataset.id);
    if (!c) return null;
    if (c.type === 'subharness') {
      // dropped onto an interface connector inside the sub-harness block
      c = derived.subs.get(c.id)?.virtuals.find((v) => {
        const b = schBox(v);
        return w.x >= b.x && w.x <= b.x + b.w && w.y >= b.y && w.y <= b.y + b.h;
      });
      if (!c) return null;
    }
    if (c.pins.length === 1) return { c: c.id, p: c.pins[0].id };
    if (c.type === 'connector') {
      const b = schBox(c);
      const i = Math.floor((w.y - b.y - SCH.headH) / SCH.rowH);
      if (i >= 0 && i < c.pins.length) return { c: c.id, p: c.pins[i].id };
    }
    if (c.type === 'device') {
      const b = schBox(c);
      return { c: c.id, p: c.pins[w.x < b.x + b.w / 2 ? 0 : 1].id };
    }
    return null;
  }

  function startWireMidDrag(e, wireId) {
    const geo = computeWireGeometry(useEditor.getState().doc, derived).get(wireId);
    if (!geo || geo.pts.length !== 4) return;
    let first = true;
    startDrag(e, {
      onMove: (ev) => {
        if (first) {
          useEditor.getState().checkpoint();
          first = false;
        }
        const w = toWorldEv(ev);
        const cur = useEditor.getState().doc;
        useEditor.getState().replaceDoc({
          ...cur,
          wires: cur.wires.map((x) => (x.id === wireId ? { ...x, schMid: snap(w.x, 5) } : x)),
        });
      },
    });
  }

  function startBoxSelect(e, world) {
    setBox({ x0: world.x, y0: world.y, x1: world.x, y1: world.y });
    startDrag(e, {
      threshold: 0,
      onMove: (ev) => {
        const w = toWorldEv(ev);
        setBox({ x0: world.x, y0: world.y, x1: w.x, y1: w.y });
      },
      onEnd: (ev) => {
        const w = toWorldEv(ev);
        setBox(null);
        const r = { x: Math.min(world.x, w.x), y: Math.min(world.y, w.y), x2: Math.max(world.x, w.x), y2: Math.max(world.y, w.y) };
        const d = useEditor.getState().doc;
        const items = [];
        for (const c of d.components) {
          const b = schBox(c, derived);
          if (b.x < r.x2 && b.x + b.w > r.x && b.y < r.y2 && b.y + b.h > r.y) items.push({ kind: 'component', id: c.id });
        }
        for (const n of d.notes) {
          if (n.view !== 'sch') continue;
          const s = noteSize(n);
          if (n.x < r.x2 && n.x + s.w > r.x && n.y < r.y2 && n.y + s.h > r.y) items.push({ kind: 'note', id: n.id });
        }
        useEditor.getState().select(items);
      },
    });
  }

  const onPointerOver = (e) => {
    const t = e.target;
    const st = useEditor.getState();
    const wEl = t.closest?.('[data-kind="wire"]');
    if (wEl) return st.setHover({ key: `w:${wEl.dataset.id}`, wireIds: [wEl.dataset.id] });
    const pEl = t.closest?.('[data-role="pin"]');
    if (pEl) {
      const ws = (derived.pinWires.get(pEl.dataset.pin) || []).map((w) => w.id);
      return st.setHover(ws.length ? { key: `p:${pEl.dataset.pin}`, wireIds: ws } : null);
    }
    st.setHover(null);
  };

  const onDoubleClick = (e) => {
    if (readOnly) return;
    const kindEl = e.target.closest?.('[data-kind="wire"]');
    if (kindEl) {
      // reset the wire path
      useEditor.getState().update((d) => {
        const w = d.wires.find((x) => x.id === kindEl.dataset.id);
        if (!w || w.schMid === undefined) return false;
        delete w.schMid;
      });
    }
  };

  return (
    <div className="ed-canvas">
      <Canvas
        ref={canvasRef}
        view="schematic"
        onPointerDown={onPointerDown}
        onContextMenu={(e, world) => onContextMenu(e, world, 'schematic')}
        onDoubleClick={onDoubleClick}
        onPointerOver={onPointerOver}
        onPointerOut={(e) => {
          if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget)) useEditor.getState().setHover(null);
        }}
      >
        <SchematicScene doc={doc} derived={derived} theme={DARK} selection={selection} hover={hover} interactive preview={preview} />
        {box && (
          <rect
            x={Math.min(box.x0, box.x1)}
            y={Math.min(box.y0, box.y1)}
            width={Math.abs(box.x1 - box.x0)}
            height={Math.abs(box.y1 - box.y0)}
            fill="rgba(91,157,255,0.08)"
            stroke="#5b9dff"
            strokeDasharray="4 3"
            pointerEvents="none"
          />
        )}
      </Canvas>
      <div className="canvas-hud">
        <button onClick={() => canvasRef.current.zoomBy(1 / 1.2)} title={t('Zoom out')}>−</button>
        <button onClick={() => canvasRef.current.zoomBy(1.2)} title={t('Zoom in')}>＋</button>
        <button onClick={fit} title={t('Show everything (F)')}>{t('Fit')}</button>
      </div>
      {readOnly ? null : doc.components.length === 0 ? (
        <div className="canvas-hint">{t('Right-click the canvas or use the bar on the left to add connectors, terminals and splices.')}</div>
      ) : (
        <div className="canvas-hint">
          {t('Drag a pin = wire · drag background = pan · Shift+drag = selection box · wheel = zoom · double-click a wire = reset path · select several wires + right-click = cable/twist')}
        </div>
      )}
    </div>
  );
}
