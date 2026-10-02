// Pure rendering of the layout / formboard (used by the editor, printing and image export)
import {
  segmentPoints, roundedPath, labelPlacement, LAY, tableSize, faceSize, closestPointOnRect,
} from './geometry.js';
import { colorByCode, faceGrid, fmtNum, fmtCs, wireColorLabel, terminalSubtype } from './model.js';
import { wireEndsFor, pinRef } from './derive.js';
import { NoteShape, noteSize } from './SchematicScene.jsx';
import { truncate, FONT } from './svgUtil.js';
import { partImageUrl } from '../api.js';
import { t } from '../i18n/index.js';

export function tableRows(c, derived) {
  const rows = [];
  for (const p of c.pins) {
    const ends = wireEndsFor(derived, c.id, p.id);
    if (!ends.length) rows.push({ pin: p, end: null });
    else for (const e of ends) rows.push({ pin: p, end: e });
  }
  return rows;
}

export function faceRowsOf(c) {
  return c.faceRows || c.part?.data?.rows || (c.pins.length > 6 ? 2 : 1);
}

export function calloutBox(c, kind, derived) {
  let size;
  if (kind === 'image') size = { w: LAY.imageSize, h: LAY.imageSize };
  else if (kind === 'face') size = faceSize(c.pins.length, faceRowsOf(c));
  else size = tableSize(tableRows(c, derived).length);
  const def =
    kind === 'image'
      ? { dx: -size.w - 50, dy: -size.h / 2 }
      : kind === 'face'
        ? { dx: 46, dy: -size.h / 2 }
        : { dx: -size.w / 2, dy: -size.h - 70 };
  const off = c.callouts?.[kind] || def;
  return { x: c.lay.x + off.dx, y: c.lay.y + off.dy, w: size.w, h: size.h, off };
}

export function layoutBounds(doc, derived) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x, y, w = 0, h = 0) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  };
  for (const c of doc.components) {
    add(c.lay.x - 60, c.lay.y - 40, 120, 70);
    for (const k of ['image', 'face', 'table']) {
      if (c.show?.[k]) {
        const r = calloutBox(c, k, derived);
        add(r.x, r.y, r.w, r.h);
      }
    }
  }
  for (const n of doc.nodes) add(n.x - 20, n.y - 20, 40, 40);
  for (const s of doc.segments) for (const p of s.points || []) add(p.x - 10, p.y - 10, 20, 20);
  for (const n of doc.notes) if (n.view === 'lay') add(n.x, n.y, noteSize(n).w, noteSize(n).h);
  if (minX === Infinity) return { x: 0, y: 0, w: 800, h: 600 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function Glyph({ c, theme, selected, dim }) {
  const { x, y } = c.lay;
  const sel = selected ? (
    <rect x={x - 20} y={y - 17} width={40} height={32} rx={8} fill="none" stroke={theme.select} strokeWidth={2} strokeDasharray="4 3" />
  ) : null;
  const op = dim ? 0.35 : 1;
  if (c.type === 'connector') {
    const fill = c.part?.data?.color?.hex || '#a3a8b0';
    return (
      <g opacity={op}>
        {sel}
        <rect x={x - 14} y={y - 10} width={28} height={20} rx={5} fill={fill} stroke={theme.segmentEdge} strokeWidth={1.2} />
        <rect x={x - 10} y={y - 13} width={20} height={4} rx={1.5} fill={theme.segmentEdge} />
      </g>
    );
  }
  if (c.type === 'terminal') {
    const st = terminalSubtype(c.subtype);
    return (
      <g opacity={op}>
        {sel}
        {c.subtype === 'ring' || c.subtype === 'spade' ? (
          <>
            <circle cx={x} cy={y - 7} r={6} fill="none" stroke={theme.node} strokeWidth={3} />
            <rect x={x - 3} y={y - 2} width={6} height={9} rx={1.5} fill={theme.node} />
          </>
        ) : (
          <>
            <rect x={x - 4} y={y - 11} width={8} height={18} rx={2} fill={theme.node} />
            <text x={x + 9} y={y + 4} fontSize={10} fill={theme.textMuted}>
              {st.symbol}
            </text>
          </>
        )}
      </g>
    );
  }
  if (c.type === 'subharness') {
    return (
      <g opacity={op}>
        {sel}
        <rect x={x - 16} y={y - 12} width={32} height={24} rx={5} fill={theme.compHeader} stroke={theme.node} strokeWidth={1.4} strokeDasharray="4 2" />
        <text x={x} y={y + 5} fontSize={13} textAnchor="middle" fill={theme.text}>
          ⧉
        </text>
      </g>
    );
  }
  if (c.type === 'splice') {
    return (
      <g opacity={op}>
        {sel}
        <rect x={x - 9} y={y - 5} width={18} height={10} rx={3} fill={theme.node} stroke={theme.segmentEdge} strokeWidth={1} />
      </g>
    );
  }
  return (
    <g opacity={op}>
      {sel}
      <rect x={x - 13} y={y - 8} width={26} height={16} rx={3} fill={theme.compHeader} stroke={theme.node} strokeWidth={1.2} />
      <text x={x} y={y + 4} fontSize={9} textAnchor="middle" fill={theme.text}>
        {c.subtype === 'diode' ? '▶|' : 'R'}
      </text>
    </g>
  );
}

function FaceCallout({ c, rect, theme, derived, highlightPins }) {
  const rows = faceRowsOf(c);
  const grid = faceGrid(c.pins.length, rows, c.part?.data?.numbering || 'rowwise');
  const cell = LAY.faceCell;
  return (
    <g>
      <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={12} fill={theme.faceFill} stroke={theme.calloutStroke} />
      {grid.map((row, ri) =>
        row.map((idx, ci) => {
          if (idx === null) return null;
          const p = c.pins[idx];
          const cx = rect.x + 8 + ci * cell + cell / 2;
          const cy = rect.y + 8 + ri * cell + cell / 2;
          const used = (derived.pinWires.get(p.id) || []).length > 0;
          const hl = highlightPins.has(p.id);
          return (
            <g key={p.id} data-pinhover={p.id}>
              <circle cx={cx} cy={cy} r={cell / 2 - 3} fill={hl ? theme.highlight : used ? theme.cavityUsed : theme.cavity} stroke={theme.calloutStroke} />
              <text x={cx} y={cy + 3.5} fontSize={p.name.length > 2 ? 8 : 10} textAnchor="middle" fill={hl ? '#111' : theme.cavityText}>
                {p.name}
              </text>
            </g>
          );
        })
      )}
    </g>
  );
}

function TableCallout({ c, rect, theme, derived, hoverSet }) {
  const rows = tableRows(c, derived);
  const [cPin, cDest, cWire, cLen] = LAY.tableCols;
  const x0 = rect.x;
  const heads = [t('Pin'), t('To'), t('Wire'), t('Length')];
  const xs = [x0 + 8, x0 + cPin + 6, x0 + cPin + cDest + 6, x0 + rect.w - 8];
  return (
    <g>
      <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={6} fill={theme.calloutFill} stroke={theme.calloutStroke} />
      {heads.map((h, i) => (
        <text key={h} x={xs[i]} y={rect.y + 15} fontSize={9.5} fill={theme.textMuted} textAnchor={i === 3 ? 'end' : 'start'}>
          {h}
        </text>
      ))}
      {rows.map((r, i) => {
        const y = rect.y + LAY.tableHeadH + i * LAY.tableRowH;
        const w = r.end?.wire;
        const hl = w && hoverSet?.has(w.id);
        const dim = hoverSet && !hl;
        const fn = r.end?.other?.pin?.fn;
        return (
          <g key={i} data-wire={w?.id} opacity={dim ? 0.45 : 1} style={w ? { cursor: 'pointer' } : undefined}>
            <rect x={rect.x} y={y} width={rect.w} height={LAY.tableRowH} fill="transparent" />
            <line x1={rect.x} x2={rect.x + rect.w} y1={y} y2={y} stroke={theme.rowStroke} />
            {hl && <rect x={rect.x + 1} y={y + 1} width={rect.w - 2} height={LAY.tableRowH - 2} fill={theme.highlight} fillOpacity={0.18} />}
            <text x={xs[0]} y={y + 14} fontSize={10} fill={theme.textMuted}>
              {r.pin.name}
            </text>
            <text x={xs[1]} y={y + 14} fontSize={10.5} fill={theme.text} fontWeight={hl ? 700 : 400}>
              {w ? truncate(`${pinRef(r.end.other)}${fn ? ` (${fn})` : ''}`, cDest - 10, 10.5) : '—'}
            </text>
            {w && (
              <>
                <rect x={xs[2]} y={y + 7} width={16} height={5} rx={2.5} fill={colorByCode(w.color).hex} stroke={theme.calloutStroke} strokeWidth={0.6} />
                <text x={xs[2] + 21} y={y + 14} fontSize={10} fill={theme.text}>
                  {truncate(`${fmtNum(w.cs, 2)} ${wireColorLabel(w)}`, cWire - 26, 10)}
                </text>
                <text x={xs[3]} y={y + 14} fontSize={10} fill={theme.text} textAnchor="end">
                  {r.end.info.length === null ? '–' : `${fmtNum(Math.round(r.end.info.length), 0)} mm`}
                </text>
              </>
            )}
          </g>
        );
      })}
    </g>
  );
}

export default function LayoutScene({
  doc, derived, theme, selection = [], hover = null, interactive = false, images = null, preview = null, tool = 'select',
}) {
  const selIds = new Set(selection.map((s) => s.id));
  const hoverSet = hover?.wireIds?.length ? new Set(hover.wireIds) : null;
  const routeSegs = new Set();
  const activeNodes = new Set();
  const highlightPins = new Set();
  if (hoverSet) {
    for (const id of hoverSet) {
      const info = derived.wireInfo.get(id);
      if (!info) continue;
      highlightPins.add(info.wire.from.p);
      highlightPins.add(info.wire.to.p);
      activeNodes.add(info.wire.from.c);
      activeNodes.add(info.wire.to.c);
      info.route?.segIds.forEach((s) => routeSegs.add(s));
      info.route?.nodeIds.forEach((n) => activeNodes.add(n));
    }
  }
  const segGeoms = [];
  for (const s of doc.segments) {
    const pts = segmentPoints(s, derived);
    if (pts) segGeoms.push({ s, pts, d: roundedPath(pts, 16) });
  }

  // label to the right of the component when a segment leaves upwards
  const labelRight = new Set();
  for (const { s, pts } of segGeoms) {
    for (const [end, nb] of [[s.a, pts[1]], [s.b, pts[pts.length - 2]]]) {
      const c = derived.comps.get(end);
      if (!c || !nb) continue;
      const dx = nb.x - c.lay.x;
      const dy = nb.y - c.lay.y;
      if (dy < 0 && Math.abs(dx) < Math.abs(dy)) labelRight.add(c.id);
    }
  }

  const imgHref = (c) => {
    if (!c.part?.hasImage) return null;
    if (images) return images[c.part.id] || null;
    return partImageUrl(c.part);
  };

  return (
    <g fontFamily={FONT}>
      {doc.notes
        .filter((n) => n.view === 'lay')
        .map((n) => (
          <NoteShape key={n.id} n={n} theme={theme} selected={selIds.has(n.id)} />
        ))}

      {/* callout leader lines */}
      {doc.components.map((c) =>
        ['image', 'face', 'table'].map((k) => {
          if (!c.show?.[k]) return null;
          const r = calloutBox(c, k, derived);
          const p = closestPointOnRect(r, c.lay);
          return <line key={`${c.id}-${k}-l`} x1={c.lay.x} y1={c.lay.y} x2={p.x} y2={p.y} stroke={theme.leader} strokeWidth={1} pointerEvents="none" />;
        })
      )}

      {/* segments */}
      {segGeoms.map(({ s, d }) => {
        const n = derived.segInfo.get(s.id)?.wires.length || 0;
        const w = 5 + Math.min(9, n * 0.8);
        const dim = hoverSet && !routeSegs.has(s.id);
        const hasCov = (s.coverings || []).length > 0;
        return (
          <g key={s.id} data-kind="segment" data-id={s.id} opacity={dim ? 0.35 : 1} style={interactive ? { cursor: 'pointer' } : undefined}>
            {interactive && <path d={d} fill="none" stroke="transparent" strokeWidth={w + 14} strokeLinecap="round" />}
            {selIds.has(s.id) && <path d={d} fill="none" stroke={theme.select} strokeOpacity={0.55} strokeWidth={w + 8} strokeLinecap="round" strokeLinejoin="round" />}
            {hasCov && <path d={d} fill="none" stroke={theme.segmentEdge} strokeWidth={w + 6} strokeLinecap="butt" strokeLinejoin="round" strokeDasharray="2.5 2" />}
            <path d={d} fill="none" stroke={theme.segmentEdge} strokeWidth={w + 2} strokeLinecap="round" strokeLinejoin="round" />
            <path d={d} fill="none" stroke={theme.segment} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
          </g>
        );
      })}

      {/* highlighted wire routes */}
      {hoverSet &&
        [...hoverSet].map((id) => {
          const info = derived.wireInfo.get(id);
          if (!info?.route) return null;
          const hex = colorByCode(info.wire.color).hex;
          return info.route.segIds.map((sid, i) => {
            const g = segGeoms.find((x) => x.s.id === sid);
            if (!g) return null;
            return (
              <path key={`${id}-${i}`} d={g.d} fill="none" stroke={hex} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
            );
          });
        })}

      {/* length labels */}
      {segGeoms.map(({ s, pts }) => {
        const lp = labelPlacement(pts);
        if (lp.segLen < 24) return null;
        const ok = Number(s.length) > 0;
        const text = ok ? `${fmtNum(s.length, 1)} mm` : '? mm';
        const covText =
          lp.segLen > 120
            ? (s.coverings || []).map((cv) => cv.part?.partNumber || cv.part?.description || cv.label).filter(Boolean).join(', ')
            : '';
        return (
          <g key={`${s.id}-lbl`} transform={`translate(${lp.x},${lp.y}) rotate(${lp.angle})`} data-kind="segment" data-id={s.id} data-role="seglen" style={interactive ? { cursor: 'text' } : undefined} opacity={hoverSet && !routeSegs.has(s.id) ? 0.4 : 1}>
            {interactive && <rect x={-32} y={-11} width={64} height={15} fill="transparent" />}
            <text x={0} y={0} fontSize={11} textAnchor="middle" fill={ok ? theme.lenText : '#e5a33b'} fontWeight={ok ? 400 : 700}>
              {text}
            </text>
            {covText && (
              <text x={0} y={-12} fontSize={9} textAnchor="middle" fill={theme.textMuted}>
                {truncate(covText, Math.min(220, lp.segLen - 30), 9)}
              </text>
            )}
          </g>
        );
      })}

      {/* bend points of the selected segment */}
      {interactive &&
        segGeoms
          .filter(({ s }) => selIds.has(s.id))
          .map(({ s }) =>
            (s.points || []).map((p, i) => (
              <rect key={`${s.id}-b${i}`} x={p.x - 5} y={p.y - 5} width={10} height={10} rx={2} fill={theme.bg} stroke={theme.select} strokeWidth={2} data-role="bend" data-id={s.id} data-index={i} style={{ cursor: 'move' }} />
            ))
          )}

      {/* mated pairs */}
      {derived.matePairs.map(([a, b]) => {
        const dx = b.lay.x - a.lay.x;
        const dy = b.lay.y - a.lay.y;
        const len = Math.hypot(dx, dy);
        if (len < 40) return null;
        const ux = dx / len;
        const uy = dy / len;
        const p1 = { x: a.lay.x + ux * 20, y: a.lay.y + uy * 20 };
        const p2 = { x: b.lay.x - ux * 20, y: b.lay.y - uy * 20 };
        const head = (p, dir) => {
          const hx = p.x + dir * ux * 7;
          const hy = p.y + dir * uy * 7;
          return `M${p.x},${p.y} L${hx - uy * 4},${hy + ux * 4} M${p.x},${p.y} L${hx + uy * 4},${hy - ux * 4}`;
        };
        return (
          <g key={`${a.id}-${b.id}`} pointerEvents="none" stroke={theme.mate} strokeWidth={1.4} fill="none">
            <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} />
            <path d={head(p1, 1)} />
            <path d={head(p2, -1)} />
          </g>
        );
      })}

      {/* branch points */}
      {doc.nodes.map((n) => {
        const sel = selIds.has(n.id);
        const dim = hoverSet && !activeNodes.has(n.id);
        return (
          <g key={n.id} data-kind="node" data-id={n.id} className="lay-node" opacity={dim ? 0.35 : 1} style={interactive ? { cursor: tool === 'segment' ? 'crosshair' : 'move' } : undefined}>
            {interactive && <circle cx={n.x} cy={n.y} r={11} fill="transparent" />}
            <rect x={n.x - 6} y={n.y - 6} width={12} height={12} rx={2.5} fill={theme.segment} stroke={sel ? theme.select : theme.segmentEdge} strokeWidth={sel ? 2.5 : 1.2} />
            {n.label && (
              <text x={n.x + 10} y={n.y - 9} fontSize={10} fill={theme.textMuted}>
                {n.label}
              </text>
            )}
            {interactive && tool !== 'segment' && (
              <g className="lay-handle" data-role="handle">
                <circle cx={n.x + 16} cy={n.y - 16} r={7} fill={theme.select} />
                <text x={n.x + 16} y={n.y - 12.5} fontSize={11} textAnchor="middle" fill="#fff" pointerEvents="none">
                  +
                </text>
              </g>
            )}
          </g>
        );
      })}

      {/* components */}
      {doc.components.map((c) => {
        const sel = selIds.has(c.id);
        const dim = hoverSet && !activeNodes.has(c.id);
        const title = c.part?.partNumber || '';
        const top = c.type === 'terminal' ? 24 : 20;
        const right = labelRight.has(c.id);
        const lx = right ? c.lay.x + 24 : c.lay.x;
        const anchor = right ? 'start' : 'middle';
        const ly1 = right ? c.lay.y + (title ? -2 : 4) : c.lay.y - (title ? top + 12 : top);
        const ly2 = right ? c.lay.y + 11 : c.lay.y - top + 1;
        const hx = right ? c.lay.x - 22 : c.lay.x + 22;
        return (
          <g key={c.id} data-kind="component" data-id={c.id} className="lay-node" style={interactive ? { cursor: tool === 'segment' ? 'crosshair' : 'move' } : undefined}>
            {interactive && <circle cx={c.lay.x} cy={c.lay.y} r={18} fill="transparent" />}
            <Glyph c={c} theme={theme} selected={sel} dim={dim} />
            <text x={lx} y={ly1} fontSize={12} fontWeight={700} textAnchor={anchor} fill={theme.text} opacity={dim ? 0.4 : 1}>
              {c.label}
            </text>
            {title && (
              <text x={lx} y={ly2} fontSize={9.5} textAnchor={anchor} fill={theme.textMuted} opacity={dim ? 0.4 : 1}>
                {truncate(title, 150, 9.5)}
              </text>
            )}
            {interactive && tool !== 'segment' && (
              <g className="lay-handle" data-role="handle">
                <circle cx={hx} cy={c.lay.y + 14} r={7} fill={theme.select} />
                <text x={hx} y={c.lay.y + 17.5} fontSize={11} textAnchor="middle" fill="#fff" pointerEvents="none">
                  +
                </text>
              </g>
            )}
          </g>
        );
      })}

      {/* callouts */}
      {doc.components.map((c) =>
        ['image', 'face', 'table'].map((k) => {
          if (!c.show?.[k]) return null;
          const r = calloutBox(c, k, derived);
          const common = { 'data-kind': 'callout', 'data-id': c.id, 'data-callout': k, style: interactive ? { cursor: 'move' } : undefined };
          if (k === 'image') {
            const href = imgHref(c);
            return (
              <g key={`${c.id}-${k}`} {...common}>
                <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={8} fill={theme.imageBg} stroke={theme.calloutStroke} />
                {href ? (
                  <image href={href} x={r.x + 4} y={r.y + 4} width={r.w - 8} height={r.h - 8} preserveAspectRatio="xMidYMid meet" />
                ) : (
                  <text x={r.x + r.w / 2} y={r.y + r.h / 2 + 4} fontSize={10} textAnchor="middle" fill="#888">
                    {t('no image')}
                  </text>
                )}
              </g>
            );
          }
          if (k === 'face') {
            return (
              <g key={`${c.id}-${k}`} {...common}>
                <FaceCallout c={c} rect={r} theme={theme} derived={derived} highlightPins={highlightPins} />
              </g>
            );
          }
          return (
            <g key={`${c.id}-${k}`} {...common}>
              <TableCallout c={c} rect={r} theme={theme} derived={derived} hoverSet={hoverSet} />
            </g>
          );
        })
      )}

      {preview && (
        <path d={`M${preview.a.x},${preview.a.y} L${preview.b.x},${preview.b.y}`} stroke={theme.select} strokeWidth={4} strokeDasharray="8 6" strokeLinecap="round" fill="none" pointerEvents="none" />
      )}
    </g>
  );
}

export { fmtCs };
