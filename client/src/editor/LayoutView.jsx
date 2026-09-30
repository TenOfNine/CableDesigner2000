import { useEffect, useRef, useState } from 'react';
import Canvas, { startDrag } from './Canvas.jsx';
import LayoutScene, { layoutBounds, calloutBox } from './LayoutScene.jsx';
import { useEditor, isSelected } from './store.js';
import { DARK } from './theme.js';
import { snap, segmentPoints, nearestOnPolyline, fractionAlong, labelPlacement } from './geometry.js';
import { addNodeAt, addSegment, splitSegment } from './actions.js';
import { noteSize } from './SchematicScene.jsx';

export default function LayoutView({ derived, onContextMenu, fitSignal }) {
  const canvasRef = useRef(null);
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const hover = useEditor((s) => s.hover);
  const tool = useEditor((s) => s.layoutTool);
  const setTool = useEditor((s) => s.setLayoutTool);
  const readOnly = useEditor((s) => s.permission === 'read');
  const vp = useEditor((s) => s.viewports.layout);
  const [preview, setPreview] = useState(null);
  const [box, setBox] = useState(null);
  const [editLen, setEditLen] = useState(null); // { segId, value }
  const fitted = useRef(false);

  const fit = () => {
    const st = useEditor.getState();
    canvasRef.current?.fit(layoutBounds(st.doc, derived));
  };
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
    const bend = el.closest?.('[data-role="bend"]');
    if (bend && !readOnly) return startBendDrag(e, bend.dataset.id, Number(bend.dataset.index));
    const handle = el.closest?.('[data-role="handle"]');
    const kindEl = el.closest?.('[data-kind]');
    if (!kindEl) return;
    const kind = kindEl.dataset.kind;
    const id = kindEl.dataset.id;
    if ((kind === 'component' || kind === 'node') && !readOnly && (handle || tool === 'segment')) {
      return startSegmentDraw(e, id, world);
    }
    if (kind === 'component' || kind === 'node' || kind === 'note') return startMove(e, kind, id, world);
    if (kind === 'segment') {
      if (e.shiftKey) st.select([{ kind, id }], true);
      else st.select([{ kind, id }]);
      return;
    }
    if (kind === 'callout') {
      st.select([{ kind: 'component', id }]);
      if (!readOnly) startCalloutDrag(e, id, kindEl.dataset.callout, world);
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
    const base = useEditor.getState().doc;
    const comps = new Map();
    const nodes = new Map();
    const notes = new Map();
    for (const s of sel) {
      if (s.kind === 'component') {
        const c = base.components.find((x) => x.id === s.id);
        if (c) comps.set(c.id, c.lay);
      } else if (s.kind === 'node') {
        const n = base.nodes.find((x) => x.id === s.id);
        if (n) nodes.set(n.id, { x: n.x, y: n.y });
      } else if (s.kind === 'note') {
        const n = base.notes.find((x) => x.id === s.id);
        if (n) notes.set(n.id, { x: n.x, y: n.y });
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
        const g = 5;
        const cur = useEditor.getState().doc;
        useEditor.getState().replaceDoc({
          ...cur,
          components: cur.components.map((c) =>
            comps.has(c.id) ? { ...c, lay: { x: snap(comps.get(c.id).x + dx, g), y: snap(comps.get(c.id).y + dy, g) } } : c
          ),
          nodes: cur.nodes.map((n) => (nodes.has(n.id) ? { ...n, x: snap(nodes.get(n.id).x + dx, g), y: snap(nodes.get(n.id).y + dy, g) } : n)),
          notes: cur.notes.map((n) => (notes.has(n.id) ? { ...n, x: snap(notes.get(n.id).x + dx, g), y: snap(notes.get(n.id).y + dy, g) } : n)),
        });
      },
      onEnd: (ev, started) => {
        if (!started && wasSelected && sel.length > 1) useEditor.getState().select([{ kind, id }]);
      },
    });
  }

  function startSegmentDraw(e, fromId, world) {
    const a = derived.layoutPos(fromId);
    if (!a) return;
    setPreview({ a, b: world });
    startDrag(e, {
      threshold: 4,
      onMove: (ev) => setPreview({ a, b: toWorldEv(ev) }),
      onEnd: (ev, started) => {
        setPreview(null);
        const st = useEditor.getState();
        if (!started) {
          st.select([{ kind: derived.comps.has(fromId) ? 'component' : 'node', id: fromId }]);
          return;
        }
        const w = toWorldEv(ev);
        const target = document.elementFromPoint(ev.clientX, ev.clientY);
        const kEl = target?.closest?.('[data-kind]');
        let newSeg = null;
        st.update((d) => {
          let toId = null;
          const k = kEl?.dataset.kind;
          if ((k === 'component' || k === 'node') && kEl.dataset.id !== fromId) toId = kEl.dataset.id;
          else if (k === 'segment') {
            const seg = d.segments.find((s) => s.id === kEl.dataset.id);
            const pts = seg && segmentPoints(seg, derived);
            if (!pts) return false;
            const hit = nearestOnPolyline(pts, w);
            const node = splitSegment(d, seg.id, hit, fractionAlong(pts, hit));
            toId = node.id;
          } else if (!k || k === 'note') {
            toId = addNodeAt(d, w).id;
          }
          if (!toId) return false;
          newSeg = addSegment(d, fromId, toId);
          if (!newSeg) return false;
        });
        if (newSeg) {
          st.select([{ kind: 'segment', id: newSeg.id }]);
          setEditLen({ segId: newSeg.id, value: '' });
        }
      },
    });
  }

  function startBendDrag(e, segId, index) {
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
          segments: cur.segments.map((s) =>
            s.id === segId ? { ...s, points: s.points.map((p, i) => (i === index ? { x: snap(w.x, 5), y: snap(w.y, 5) } : p)) } : s
          ),
        });
      },
    });
  }

  function startCalloutDrag(e, compId, kind, world) {
    const c = useEditor.getState().doc.components.find((x) => x.id === compId);
    const start = calloutBox(c, kind, derived).off;
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
          components: cur.components.map((x) =>
            x.id === compId
              ? { ...x, callouts: { ...x.callouts, [kind]: { dx: snap(start.dx + w.x - world.x, 5), dy: snap(start.dy + w.y - world.y, 5) } } }
              : x
          ),
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
        const inR = (x, y) => x >= r.x && x <= r.x2 && y >= r.y && y <= r.y2;
        const d = useEditor.getState().doc;
        const items = [
          ...d.components.filter((c) => inR(c.lay.x, c.lay.y)).map((c) => ({ kind: 'component', id: c.id })),
          ...d.nodes.filter((n) => inR(n.x, n.y)).map((n) => ({ kind: 'node', id: n.id })),
          ...d.notes.filter((n) => n.view === 'lay' && inR(n.x + noteSize(n).w / 2, n.y + noteSize(n).h / 2)).map((n) => ({ kind: 'note', id: n.id })),
        ];
        useEditor.getState().select(items);
      },
    });
  }

  const onDoubleClick = (e) => {
    if (readOnly) return;
    const lenEl = e.target.closest?.('[data-role="seglen"]');
    const bend = e.target.closest?.('[data-role="bend"]');
    if (bend) {
      const segId = bend.dataset.id;
      const idx = Number(bend.dataset.index);
      useEditor.getState().update((d) => {
        const s = d.segments.find((x) => x.id === segId);
        if (!s) return false;
        s.points.splice(idx, 1);
      });
      return;
    }
    const segEl = lenEl || e.target.closest?.('[data-kind="segment"]');
    if (segEl) {
      const seg = useEditor.getState().doc.segments.find((s) => s.id === segEl.dataset.id);
      if (seg) setEditLen({ segId: seg.id, value: seg.length ? String(seg.length).replace('.', ',') : '' });
    }
  };

  const onPointerOver = (e) => {
    const st = useEditor.getState();
    const row = e.target.closest?.('[data-wire]');
    if (row && row.dataset.wire) return st.setHover({ key: `w:${row.dataset.wire}`, wireIds: [row.dataset.wire] });
    const cav = e.target.closest?.('[data-pinhover]');
    if (cav) {
      const ws = (derived.pinWires.get(cav.dataset.pinhover) || []).map((w) => w.id);
      return st.setHover(ws.length ? { key: `p:${cav.dataset.pinhover}`, wireIds: ws } : null);
    }
    const seg = e.target.closest?.('[data-kind="segment"]');
    if (seg && e.altKey) {
      const ws = derived.segInfo.get(seg.dataset.id)?.wires || [];
      return st.setHover(ws.length ? { key: `s:${seg.dataset.id}`, wireIds: ws } : null);
    }
    st.setHover(null);
  };

  // Position des Längen-Eingabefelds
  let lenPos = null;
  if (editLen) {
    const seg = doc.segments.find((s) => s.id === editLen.segId);
    const pts = seg && segmentPoints(seg, derived);
    if (pts) {
      const lp = labelPlacement(pts);
      lenPos = { x: lp.x * vp.k + vp.x - 45, y: lp.y * vp.k + vp.y - 16 };
    }
  }
  const commitLen = (close = true) => {
    if (!editLen) return;
    const raw = String(editLen.value).replace(',', '.').replace(/[^\d.]/g, '');
    const v = raw === '' ? null : Math.max(0, Number(raw));
    if (v !== null && !Number.isNaN(v)) {
      useEditor.getState().update((d) => {
        const s = d.segments.find((x) => x.id === editLen.segId);
        if (!s || s.length === v) return false;
        s.length = v;
      });
    }
    if (close) setEditLen(null);
  };

  return (
    <div className="ed-canvas">
      <Canvas
        ref={canvasRef}
        view="layout"
        onPointerDown={onPointerDown}
        onContextMenu={(e, world) => onContextMenu(e, world, 'layout')}
        onDoubleClick={onDoubleClick}
        onPointerOver={onPointerOver}
        onPointerOut={(e) => {
          if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget)) useEditor.getState().setHover(null);
        }}
      >
        <LayoutScene doc={doc} derived={derived} theme={DARK} selection={selection} hover={hover} interactive preview={preview} tool={tool} />
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
      {!readOnly && (
        <div className="canvas-tools">
          <button className={tool === 'select' ? 'active' : ''} onClick={() => setTool('select')} title="Auswählen und verschieben (V)">
            ↖ Auswählen
          </button>
          <button className={tool === 'segment' ? 'active' : ''} onClick={() => setTool('segment')} title="Segmente zeichnen (S)">
            ⟋ Segment zeichnen
          </button>
        </div>
      )}
      {editLen && lenPos && (
        <input
          className="len-input"
          autoFocus
          style={{ left: lenPos.x, top: lenPos.y }}
          placeholder="Länge mm"
          value={editLen.value}
          onChange={(e) => setEditLen({ ...editLen, value: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitLen();
            if (e.key === 'Escape') setEditLen(null);
            e.stopPropagation();
          }}
          onBlur={() => commitLen()}
        />
      )}
      <div className="canvas-hud">
        <button onClick={() => canvasRef.current.zoomBy(1 / 1.2)} title="Verkleinern">−</button>
        <button onClick={() => canvasRef.current.zoomBy(1.2)} title="Vergrößern">＋</button>
        <button onClick={fit} title="Alles anzeigen (F)">Einpassen</button>
      </div>
      {!readOnly && <div className="canvas-hint">
        {tool === 'segment'
          ? 'Von einem Bauteil/Abzweig ziehen = Segment · auf ein Segment ziehen = T-Abzweig · auf freie Fläche = neuer Abzweigpunkt'
          : 'Am ＋-Griff ziehen = Segment · Doppelklick auf Länge = bearbeiten · Rechtsklick auf Segment = Abzweig/Knick/Ummantelung · Alt+Hover = Leitungen im Segment'}
      </div>}
    </div>
  );
}
