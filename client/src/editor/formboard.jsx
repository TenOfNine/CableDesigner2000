// Formboard 1:1: true-to-scale geometry from the layout topology and the segment lengths,
// plus tiling onto several printed pages.
//
// Algorithm: the segment graph is traversed breadth-first. Every segment keeps the direction(s)
// drawn by the user, but its polyline is scaled so that its length equals the entered length.
// In a tree this is exact; for meshes (loops) the closing segment is drawn distorted and reported.
import { segmentPoints, polylineLength, labelPlacement, roundedPath } from './geometry.js';
import { fmtNum, partTitle } from './model.js';
import { FONT, truncate } from './svgUtil.js';
import { t } from '../i18n/index.js';

const GROUP_GAP = 150; // mm between independent harness parts

export function computeFormboard(doc, derived) {
  const adj = new Map();
  const segs = [];
  for (const s of doc.segments) {
    const pts = segmentPoints(s, derived);
    if (!pts) continue;
    segs.push({ s, pts });
    for (const [u, v] of [[s.a, s.b], [s.b, s.a]]) {
      if (!adj.has(u)) adj.set(u, []);
      adj.get(u).push({ s, pts, other: v });
    }
  }
  const pos = new Map();
  const segPts = new Map();
  const warnings = [];
  const done = new Set();
  const groups = [];

  for (const startCandidate of adj.keys()) {
    if (pos.has(startCandidate)) continue;
    // collect the connected group, start at the node with the most segments
    const members = [];
    const seen = new Set([startCandidate]);
    const q0 = [startCandidate];
    while (q0.length) {
      const u = q0.shift();
      members.push(u);
      for (const e of adj.get(u) || []) if (!seen.has(e.other)) seen.add(e.other) && q0.push(e.other);
    }
    const start = members.reduce((best, id) => ((adj.get(id)?.length || 0) > (adj.get(best)?.length || 0) ? id : best), members[0]);
    const groupSegs = [];
    pos.set(start, { x: 0, y: 0 });
    const queue = [start];
    while (queue.length) {
      const u = queue.shift();
      for (const e of adj.get(u) || []) {
        if (done.has(e.s.id)) continue;
        done.add(e.s.id);
        groupSegs.push(e.s.id);
        const drawn = e.s.a === u ? e.pts : [...e.pts].reverse();
        const drawnLen = polylineLength(drawn) || 1;
        let real = Number(e.s.length);
        if (!(real > 0)) {
          real = drawnLen;
          warnings.push(t('Segment {a} – {b} has no length; the drawn length is used.', { a: derived.nodeLabel(e.s.a), b: derived.nodeLabel(e.s.b) }));
        }
        const k = real / drawnLen;
        const out = [pos.get(u)];
        for (let i = 1; i < drawn.length; i++) {
          const p = out[i - 1];
          out.push({ x: p.x + (drawn[i].x - drawn[i - 1].x) * k, y: p.y + (drawn[i].y - drawn[i - 1].y) * k });
        }
        if (!pos.has(e.other)) {
          pos.set(e.other, out[out.length - 1]);
          queue.push(e.other);
        } else {
          const target = pos.get(e.other);
          const end = out[out.length - 1];
          if (Math.hypot(target.x - end.x, target.y - end.y) > 1) {
            warnings.push(t('Loop at segment {a} – {b}: it cannot be drawn to scale and is shown distorted.', { a: derived.nodeLabel(e.s.a), b: derived.nodeLabel(e.s.b) }));
          }
          out[out.length - 1] = target;
        }
        segPts.set(e.s.id, e.s.a === u ? out : [...out].reverse());
      }
    }
    groups.push({ nodes: members, segs: groupSegs });
  }

  // place independent groups next to each other
  let offsetX = 0;
  for (const g of groups) {
    const b = boundsOf(g.nodes.map((n) => pos.get(n)), g.segs.flatMap((id) => segPts.get(id)));
    const dx = offsetX - b.x;
    const dy = -b.y;
    for (const n of g.nodes) {
      const p = pos.get(n);
      pos.set(n, { x: p.x + dx, y: p.y + dy });
    }
    for (const id of g.segs) segPts.set(id, segPts.get(id).map((p) => ({ x: p.x + dx, y: p.y + dy })));
    offsetX += b.w + GROUP_GAP;
  }

  const placed = new Set(pos.keys());
  const unplaced = doc.components.filter((c) => !placed.has(c.id));
  if (unplaced.length) warnings.push(t('Not on the formboard (no segments): {names}', { names: unplaced.map((c) => c.label).join(', ') }));

  const pad = 40;
  const all = boundsOf([...pos.values()], [...segPts.values()].flat());
  const bounds = { x: all.x - pad, y: all.y - pad - 10, w: all.w + 2 * pad, h: all.h + 2 * pad + 10 };
  return { pos, segPts, warnings: [...new Set(warnings)], bounds, empty: pos.size === 0 };
}

function boundsOf(points, more = []) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of [...points, ...more]) {
    if (!p) continue;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (minX === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Splits the formboard into pages. Dimensions in mm. */
export function computeTiles(fb, { pageW, pageH, overlap = 10 }) {
  const b = fb.bounds;
  const stepX = pageW - overlap;
  const stepY = pageH - overlap;
  const cols = Math.max(1, Math.ceil((b.w - overlap) / stepX));
  const rows = Math.max(1, Math.ceil((b.h - overlap) / stepY));
  // content samples to skip empty pages
  const samples = [...fb.pos.values()];
  for (const pts of fb.segPts.values()) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const c = pts[i];
      const n = Math.max(1, Math.ceil(Math.hypot(c.x - a.x, c.y - a.y) / 5));
      for (let j = 0; j <= n; j++) samples.push({ x: a.x + ((c.x - a.x) * j) / n, y: a.y + ((c.y - a.y) * j) / n });
    }
  }
  const tiles = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = b.x + c * stepX;
      const y = b.y + r * stepY;
      const m = 15;
      const used = samples.some((p) => p.x >= x - m && p.x <= x + pageW + m && p.y >= y - m && p.y <= y + pageH + m);
      tiles.push({ r, c, x, y, w: pageW, h: pageH, name: `${String.fromCharCode(65 + (r % 26))}${c + 1}`, used });
    }
  }
  return { rows, cols, overlap, tiles, used: tiles.filter((x) => x.used) };
}

/** Formboard drawing in millimetre units (1 unit = 1 mm) */
export function FormboardScene({ fb, doc, derived, theme, tile = null, showGrid = false }) {
  const label = 3.6;
  const small = 2.6;
  const comps = doc.components.filter((c) => fb.pos.has(c.id));
  const nodes = doc.nodes.filter((n) => fb.pos.has(n.id));
  return (
    <g fontFamily={FONT}>
      {showGrid && tile && <TileGrid tile={tile} theme={theme} />}
      {doc.segments.map((s) => {
        const pts = fb.segPts.get(s.id);
        if (!pts) return null;
        const info = derived.segInfo.get(s.id);
        const w = Math.max(2, info?.bundleDiameter || 0);
        const d = roundedPath(pts, 12);
        const hasCov = (s.coverings || []).length > 0;
        return (
          <g key={s.id}>
            {hasCov && <path d={d} fill="none" stroke={theme.segmentEdge} strokeWidth={w + 3} strokeDasharray="1.5 1" />}
            <path d={d} fill="none" stroke={theme.segmentEdge} strokeWidth={w + 0.8} strokeLinecap="round" strokeLinejoin="round" />
            <path d={d} fill="none" stroke={theme.segment} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
          </g>
        );
      })}
      {doc.segments.map((s) => {
        const pts = fb.segPts.get(s.id);
        if (!pts) return null;
        const lp = labelPlacement(pts);
        const off = Math.max(3, (derived.segInfo.get(s.id)?.bundleDiameter || 2) / 2 + 2.5);
        const rad = (lp.angle * Math.PI) / 180;
        const cx = lp.x - Math.sin(rad) * (13 - off);
        const cy = lp.y + Math.cos(rad) * (13 - off);
        const cov = (s.coverings || []).map((c) => c.part?.partNumber || c.part?.description || c.label).filter(Boolean).join(', ');
        return (
          <g key={`${s.id}-l`} transform={`translate(${cx},${cy}) rotate(${lp.angle})`}>
            <text x={0} y={0} fontSize={label} textAnchor="middle" fill={theme.text} fontWeight={700}>
              {Number(s.length) > 0 ? `${fmtNum(s.length, 1)} mm` : '?'}
            </text>
            {cov && (
              <text x={0} y={-label - 0.6} fontSize={small} textAnchor="middle" fill={theme.textMuted}>
                {truncate(cov, Math.max(20, lp.segLen - 10), small)}
              </text>
            )}
          </g>
        );
      })}
      {nodes.map((n) => {
        const p = fb.pos.get(n.id);
        return (
          <g key={n.id}>
            <circle cx={p.x} cy={p.y} r={1.8} fill={theme.bg} stroke={theme.text} strokeWidth={0.5} />
            <line x1={p.x - 3} x2={p.x + 3} y1={p.y} y2={p.y} stroke={theme.text} strokeWidth={0.3} />
            <line x1={p.x} x2={p.x} y1={p.y - 3} y2={p.y + 3} stroke={theme.text} strokeWidth={0.3} />
            {n.label && (
              <text x={p.x + 3} y={p.y - 3} fontSize={small} fill={theme.textMuted}>
                {n.label}
              </text>
            )}
          </g>
        );
      })}
      {comps.map((c) => {
        const p = fb.pos.get(c.id);
        const title = c.part ? partTitle(c.part) : '';
        return (
          <g key={c.id}>
            <rect x={p.x - 7} y={p.y - 4.5} width={14} height={9} rx={1.5} fill={c.part?.data?.color?.hex || '#c9ccd2'} stroke={theme.text} strokeWidth={0.4} />
            <circle cx={p.x} cy={p.y} r={0.6} fill={theme.text} />
            <text x={p.x} y={p.y - 7.5 - (title ? small + 0.8 : 0)} fontSize={label} fontWeight={700} textAnchor="middle" fill={theme.text}>
              {c.label}
            </text>
            {title && (
              <text x={p.x} y={p.y - 6.5} fontSize={small} textAnchor="middle" fill={theme.textMuted}>
                {title}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

/** 50 mm reference grid with coordinates (helps aligning the printed sheets) */
function TileGrid({ tile, theme }) {
  const lines = [];
  const step = 50;
  const x0 = Math.ceil(tile.x / step) * step;
  const y0 = Math.ceil(tile.y / step) * step;
  for (let x = x0; x <= tile.x + tile.w; x += step) {
    lines.push(<line key={`x${x}`} x1={x} x2={x} y1={tile.y} y2={tile.y + tile.h} stroke="#d5d9df" strokeWidth={0.2} />);
    lines.push(
      <text key={`tx${x}`} x={x + 0.8} y={tile.y + 3} fontSize={2} fill="#9aa0a8">
        {Math.round(x)}
      </text>
    );
  }
  for (let y = y0; y <= tile.y + tile.h; y += step) {
    lines.push(<line key={`y${y}`} x1={tile.x} x2={tile.x + tile.w} y1={y} y2={y} stroke="#d5d9df" strokeWidth={0.2} />);
    lines.push(
      <text key={`ty${y}`} x={tile.x + 0.8} y={y - 0.8} fontSize={2} fill="#9aa0a8">
        {Math.round(y)}
      </text>
    );
  }
  return <g>{lines}</g>;
}
