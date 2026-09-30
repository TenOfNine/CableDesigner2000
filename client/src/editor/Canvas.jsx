import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { useEditor } from './store.js';

// Startet ein Ziehen mit globalen Listenern
export function startDrag(e, { onMove, onEnd, threshold = 3 }) {
  const sx = e.clientX;
  const sy = e.clientY;
  let started = false;
  const move = (ev) => {
    if (!started && Math.hypot(ev.clientX - sx, ev.clientY - sy) < threshold) return;
    started = true;
    onMove?.(ev);
  };
  const up = (ev) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    onEnd?.(ev, started);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

/**
 * SVG-Zeichenfläche mit Raster, Verschieben (Hintergrund ziehen / mittlere Maustaste)
 * und Zoom (Mausrad). Der Inhalt wird in Weltkoordinaten gezeichnet.
 */
const Canvas = forwardRef(function Canvas({ view, children, onPointerDown, onContextMenu, onDoubleClick, onPointerOver, onPointerOut, onBackgroundDown, overlay }, ref) {
  const svgRef = useRef(null);
  const vp = useEditor((s) => s.viewports[view]);
  const setViewport = useEditor((s) => s.setViewport);
  const vpRef = useRef(vp);
  vpRef.current = vp;

  const toWorld = useCallback((clientX, clientY) => {
    const r = svgRef.current.getBoundingClientRect();
    const v = vpRef.current;
    return { x: (clientX - r.left - v.x) / v.k, y: (clientY - r.top - v.y) / v.k };
  }, []);
  const toScreen = useCallback((x, y) => {
    const v = vpRef.current;
    return { x: x * v.k + v.x, y: y * v.k + v.y };
  }, []);

  const fit = useCallback(
    (bounds, pad = 40) => {
      const r = svgRef.current?.getBoundingClientRect();
      if (!r || !bounds || r.width === 0) return;
      const k = Math.max(0.1, Math.min(2, Math.min((r.width - pad * 2) / (bounds.w || 1), (r.height - pad * 2) / (bounds.h || 1))));
      setViewport(view, {
        k,
        x: (r.width - bounds.w * k) / 2 - bounds.x * k,
        y: (r.height - bounds.h * k) / 2 - bounds.y * k,
      });
    },
    [setViewport, view]
  );

  const zoomBy = useCallback(
    (factor, cx, cy) => {
      const r = svgRef.current.getBoundingClientRect();
      const v = vpRef.current;
      const px = cx ?? r.width / 2;
      const py = cy ?? r.height / 2;
      const k = Math.max(0.1, Math.min(4, v.k * factor));
      const f = k / v.k;
      setViewport(view, { k, x: px - (px - v.x) * f, y: py - (py - v.y) * f });
    },
    [setViewport, view]
  );

  useImperativeHandle(ref, () => ({ toWorld, toScreen, fit, zoomBy, svg: () => svgRef.current }), [toWorld, toScreen, fit, zoomBy]);

  // Mausrad-Zoom (nicht-passiv, damit die Seite nicht scrollt)
  useEffect(() => {
    const el = svgRef.current;
    const onWheel = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
        zoomBy(factor, e.clientX - r.left, e.clientY - r.top);
      } else {
        const v = vpRef.current;
        setViewport(view, { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy, setViewport, view]);

  const handleDown = (e) => {
    const isBg = e.target === svgRef.current || e.target.dataset?.bg === '1';
    if (e.button === 1 || (e.button === 0 && isBg && !e.shiftKey && !onBackgroundDown?.(e, toWorld(e.clientX, e.clientY)))) {
      // Verschieben
      e.preventDefault();
      const start = { ...vpRef.current };
      const sx = e.clientX;
      const sy = e.clientY;
      let moved = false;
      startDrag(e, {
        threshold: 2,
        onMove: (ev) => {
          moved = true;
          setViewport(view, { ...start, x: start.x + ev.clientX - sx, y: start.y + ev.clientY - sy });
        },
        onEnd: () => {
          if (!moved && e.button === 0) onPointerDown?.(e, toWorld(e.clientX, e.clientY), { background: true, click: true });
        },
      });
      return;
    }
    onPointerDown?.(e, toWorld(e.clientX, e.clientY), { background: isBg });
  };

  const gs = 20 * vp.k;
  const major = gs * 5;
  return (
    <svg
      ref={svgRef}
      onPointerDown={handleDown}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu?.(e, toWorld(e.clientX, e.clientY));
      }}
      onDoubleClick={(e) => onDoubleClick?.(e, toWorld(e.clientX, e.clientY))}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
    >
      <defs>
        <pattern id={`grid-${view}`} width={gs} height={gs} patternUnits="userSpaceOnUse" x={vp.x % gs} y={vp.y % gs}>
          <path d={`M ${gs} 0 L 0 0 0 ${gs}`} fill="none" stroke="var(--grid-minor, #16181b)" strokeWidth={1} />
        </pattern>
        <pattern id={`gridM-${view}`} width={major} height={major} patternUnits="userSpaceOnUse" x={vp.x % major} y={vp.y % major}>
          <rect width={major} height={major} fill={`url(#grid-${view})`} />
          <path d={`M ${major} 0 L 0 0 0 ${major}`} fill="none" stroke="var(--grid-major, #1d2024)" strokeWidth={1} />
        </pattern>
      </defs>
      <rect data-bg="1" x={0} y={0} width="100%" height="100%" fill={`url(#gridM-${view})`} />
      <g transform={`translate(${vp.x},${vp.y}) scale(${vp.k})`}>{children}</g>
      {overlay}
    </svg>
  );
});

export default Canvas;
