import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { LIGHT } from './theme.js';
import { Scene, sceneBounds, loadImages } from './exports.jsx';
import { wireListRows, pinoutRows, segmentRows, bomRows, cableRows } from './tables.js';
import { computeFormboard, computeTiles, FormboardScene } from './formboard.jsx';
import { fmtNum } from './model.js';
import { t, locale } from '../i18n/index.js';

export const PAPER = { A4: [297, 210], A3: [420, 297] };
export const MARGIN = 10;
export const TILE_HEADER = 9; // mm reserved for the page header of formboard tiles
export const TILE_OVERLAP = 10;

export function pageGeometry(job) {
  const [pw, ph] = PAPER[job.paper] || PAPER.A4;
  const landscape = job.orientation !== 'portrait';
  const W = landscape ? pw : ph;
  const H = landscape ? ph : pw;
  return { W, H, landscape, contentW: W - 2 * MARGIN, contentH: H - 2 * MARGIN - 1 };
}

/**
 * Renders the print content into #print-root and opens the print dialog.
 * job: { paper, orientation, explodeBom, sections: { schematic, layout, formboard, wires, bom, pinout, cables, segments } }
 */
export default function PrintView({ job, doc, derived, meta, author, onDone }) {
  const [images, setImages] = useState(null);
  useEffect(() => {
    let alive = true;
    loadImages(doc).then((imgs) => alive && setImages(imgs));
    return () => {
      alive = false;
    };
  }, [doc]);

  useEffect(() => {
    if (!images) return;
    const after = () => onDone();
    window.addEventListener('afterprint', after, { once: true });
    const timer = setTimeout(() => window.print(), 300);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('afterprint', after);
    };
  }, [images, onDone]);

  const geo = pageGeometry(job);
  const fb = useMemo(() => (job.sections.formboard ? computeFormboard(doc, derived) : null), [job, doc, derived]);
  const tiles = useMemo(
    () => (fb && !fb.empty ? computeTiles(fb, { pageW: geo.contentW, pageH: geo.contentH - TILE_HEADER, overlap: TILE_OVERLAP }) : null),
    [fb, geo.contentW, geo.contentH]
  );

  const s = doc.settings;
  const date = new Date().toLocaleDateString(locale());
  const project = (meta.breadcrumb || []).map((b) => b.name).join(' › ');
  const drawings = [job.sections.schematic && 'schematic', job.sections.layout && 'layout'].filter(Boolean);
  const titles = { schematic: t('Schematic'), layout: t('Layout / formboard') };

  const header = (title) => (
    <div className="print-head">
      <span>
        <strong>{meta.name}</strong> — {title}
      </span>
      <span>
        {s.drawingNumber ? `${t('Drawing')} ${s.drawingNumber} · ` : ''}
        {t('Rev.')} {s.revision || '–'} · {date}
      </span>
    </div>
  );

  const titleBlock = (label, sheet) => (
    <div className="print-title">
      <div>
        <div className="lbl">{t('Harness')}</div>
        <div className="val">{meta.name}</div>
      </div>
      <div>
        <div className="lbl">{t('Project')}</div>
        <div className="val">{project}</div>
      </div>
      <div>
        <div className="lbl">{t('Drawing number')}</div>
        <div className="val">{s.drawingNumber || '–'}</div>
      </div>
      <div>
        <div className="lbl">{t('Revision')}</div>
        <div className="val">{s.revision || '–'}</div>
      </div>
      <div>
        <div className="lbl">{t('Author / date')}</div>
        <div className="val">
          {s.author || author} · {date}
        </div>
      </div>
      <div>
        <div className="lbl">{label}</div>
        <div className="val">{sheet}</div>
      </div>
    </div>
  );

  const content = (
    <>
      <style>{`@page { size: ${job.paper} ${geo.landscape ? 'landscape' : 'portrait'}; margin: ${MARGIN}mm; }`}</style>
      <div className="print-doc">
        {images &&
          drawings.map((view, i) => {
            const vb = sceneBounds(view, doc, derived);
            return (
              <div key={view} className="print-page" style={{ height: `${geo.contentH}mm` }}>
                <div className="print-drawing">
                  <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
                    <Scene view={view} doc={doc} derived={derived} theme={LIGHT} images={images} />
                  </svg>
                </div>
                {titleBlock(titles[view], t('Sheet {n} / {m}', { n: i + 1, m: drawings.length }))}
              </div>
            );
          })}

        {images && fb && tiles && (
          <>
            {/* overview of the formboard with the page grid */}
            <div className="print-page" style={{ height: `${geo.contentH}mm` }}>
              {header(t('Formboard 1:1 – overview'))}
              <div className="print-drawing">
                <svg viewBox={`${fb.bounds.x} ${fb.bounds.y} ${tiles.cols * (tiles.tiles[0].w - TILE_OVERLAP) + TILE_OVERLAP} ${tiles.rows * (tiles.tiles[0].h - TILE_OVERLAP) + TILE_OVERLAP}`} preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
                  <FormboardScene fb={fb} doc={doc} derived={derived} theme={LIGHT} />
                  {tiles.tiles.map((tl) => (
                    <g key={tl.name}>
                      <rect x={tl.x} y={tl.y} width={tl.w} height={tl.h} fill="none" stroke={tl.used ? '#1d6fe0' : '#c4c8ce'} strokeWidth={1.2} strokeDasharray={tl.used ? undefined : '6 4'} />
                      <text x={tl.x + 6} y={tl.y + 16} fontSize={14} fill={tl.used ? '#1d6fe0' : '#c4c8ce'} fontWeight={700}>
                        {tl.name}
                      </text>
                    </g>
                  ))}
                </svg>
              </div>
              <div style={{ fontSize: '8pt', marginTop: '2mm' }}>
                {t('{n} pages to print ({rows} rows × {cols} columns, empty pages are skipped). Overlap {o} mm. Print at 100 % / actual size – not "fit to page". Check the 100 mm scale on each sheet.', {
                  n: tiles.used.length, rows: tiles.rows, cols: tiles.cols, o: TILE_OVERLAP,
                })}
                {fb.warnings.length > 0 && (
                  <ul style={{ margin: '1mm 0 0', paddingLeft: '5mm', color: '#a05a00' }}>
                    {fb.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            {tiles.used.map((tl) => {
              const neighbours = (dr, dc) => tiles.tiles.find((x) => x.r === tl.r + dr && x.c === tl.c + dc && x.used)?.name;
              const right = neighbours(0, 1);
              const below = neighbours(1, 0);
              return (
                <div key={tl.name} className="print-page" style={{ height: `${geo.contentH}mm`, display: 'block' }}>
                  <div style={{ height: `${TILE_HEADER}mm`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '8pt' }}>
                    <span>
                      <strong>
                        {t('Formboard 1:1')} – {t('Sheet')} {tl.name}
                      </strong>{' '}
                      ({t('row {r}, column {c}', { r: String.fromCharCode(65 + tl.r), c: tl.c + 1 })}) · {meta.name} · {t('Rev.')} {s.revision || '–'}
                    </span>
                    <svg width="104mm" height="7mm" viewBox="0 0 104 7" xmlns="http://www.w3.org/2000/svg">
                      <line x1={2} x2={102} y1={5.5} y2={5.5} stroke="#111" strokeWidth={0.4} />
                      {Array.from({ length: 11 }, (_, i) => (
                        <line key={i} x1={2 + i * 10} x2={2 + i * 10} y1={i % 5 === 0 ? 3.5 : 4.5} y2={6.5} stroke="#111" strokeWidth={i % 5 === 0 ? 0.4 : 0.25} />
                      ))}
                      <text x={52} y={2.8} fontSize={2.6} textAnchor="middle" fill="#111">
                        100 mm
                      </text>
                    </svg>
                  </div>
                  <svg width={`${tl.w}mm`} height={`${tl.h}mm`} viewBox={`${tl.x} ${tl.y} ${tl.w} ${tl.h}`} xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
                    <FormboardScene fb={fb} doc={doc} derived={derived} theme={LIGHT} tile={tl} showGrid />
                    {right && (
                      <g>
                        <rect x={tl.x + tl.w - TILE_OVERLAP} y={tl.y} width={TILE_OVERLAP} height={tl.h} fill="#1d6fe0" fillOpacity={0.06} />
                        <line x1={tl.x + tl.w - TILE_OVERLAP} x2={tl.x + tl.w - TILE_OVERLAP} y1={tl.y} y2={tl.y + tl.h} stroke="#1d6fe0" strokeWidth={0.25} strokeDasharray="2 1.5" />
                        <text x={tl.x + tl.w - TILE_OVERLAP / 2} y={tl.y + tl.h / 2} fontSize={2.6} fill="#1d6fe0" textAnchor="middle" transform={`rotate(90 ${tl.x + tl.w - TILE_OVERLAP / 2} ${tl.y + tl.h / 2})`}>
                          {t('overlap → {name}', { name: right })}
                        </text>
                      </g>
                    )}
                    {below && (
                      <g>
                        <rect x={tl.x} y={tl.y + tl.h - TILE_OVERLAP} width={tl.w} height={TILE_OVERLAP} fill="#1d6fe0" fillOpacity={0.06} />
                        <line x1={tl.x} x2={tl.x + tl.w} y1={tl.y + tl.h - TILE_OVERLAP} y2={tl.y + tl.h - TILE_OVERLAP} stroke="#1d6fe0" strokeWidth={0.25} strokeDasharray="2 1.5" />
                        <text x={tl.x + tl.w / 2} y={tl.y + tl.h - TILE_OVERLAP / 2 + 1} fontSize={2.6} fill="#1d6fe0" textAnchor="middle">
                          {t('overlap ↓ {name}', { name: below })}
                        </text>
                      </g>
                    )}
                    <rect x={tl.x + 0.15} y={tl.y + 0.15} width={tl.w - 0.3} height={tl.h - 0.3} fill="none" stroke="#9aa0a8" strokeWidth={0.3} />
                  </svg>
                </div>
              );
            })}
          </>
        )}

        {images && job.sections.wires && (
          <section className="print-section">
            {header(t('Wire list'))}
            <h2>{t('Wire list')}</h2>
            <table className="print-table">
              <thead>
                <tr>
                  <th>{t('No.')}</th>
                  <th>{t('Signal')}</th>
                  <th>{t('From')}</th>
                  <th>{t('Pin')}</th>
                  <th>{t('To')}</th>
                  <th>{t('Pin')}</th>
                  <th>{t('Colour')}</th>
                  <th className="num">mm²</th>
                  <th>{t('Type')}</th>
                  <th>{t('Cable')}</th>
                  <th className="num">{t('Length mm')}</th>
                  <th>{t('Remark')}</th>
                </tr>
              </thead>
              <tbody>
                {wireListRows(doc, derived).map((r) => (
                  <tr key={r.wireId}>
                    <td>{r.label}</td>
                    <td>{r.signal}</td>
                    <td>{r.fromComp}</td>
                    <td>{r.fromPin}</td>
                    <td>{r.toComp}</td>
                    <td>{r.toPin}</td>
                    <td>
                      <span className="print-swatch" style={{ background: r.colorHex }} />
                      {r.color}
                    </td>
                    <td className="num">{fmtNum(r.cs, 2)}</td>
                    <td>{r.type}</td>
                    <td>{r.cable}</td>
                    <td className="num">{r.length === null ? '–' : fmtNum(r.length, 0)}</td>
                    <td>{r.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: '7.5pt', color: '#555', marginTop: '2mm' }}>
              {t('Lengths include allowances: surcharge {pct} %, per wire end {end} mm.', { pct: fmtNum(s.extraPercent), end: fmtNum(s.extraPerEnd) })}
            </p>
          </section>
        )}

        {images && job.sections.bom && (
          <section className="print-section">
            {header(t('Bill of materials'))}
            <h2>
              {t('Bill of materials')}
              {derived.subs.size > 0 ? ` (${job.explodeBom ? t('exploded') : t('as assembly')})` : ''}
            </h2>
            <table className="print-table">
              <thead>
                <tr>
                  <th className="num">{t('Pos.')}</th>
                  <th>{t('Part number')}</th>
                  <th>{t('Manufacturer')}</th>
                  <th>{t('Description')}</th>
                  <th className="num">{t('Qty')}</th>
                  <th>{t('Unit')}</th>
                  <th>{t('Used by')}</th>
                </tr>
              </thead>
              <tbody>
                {bomRows(derived, !!job.explodeBom).map((r) => (
                  <tr key={r.pos}>
                    <td className="num">{r.pos}</td>
                    <td>{r.partNumber || '—'}</td>
                    <td>{r.manufacturer}</td>
                    <td>
                      {r.description}
                      {r.notes ? ` (${r.notes})` : ''}
                    </td>
                    <td className="num">{r.isMetre ? fmtNum(r.qty, 2) : r.qty}</td>
                    <td>{r.unit}</td>
                    <td>{r.refs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {images && job.sections.pinout && (
          <section className="print-section">
            {header(t('Pin assignment'))}
            <h2>{t('Pin assignment')}</h2>
            <table className="print-table">
              <thead>
                <tr>
                  <th>{t('Component')}</th>
                  <th>{t('Part')}</th>
                  <th>{t('Pin')}</th>
                  <th>{t('Function')}</th>
                  <th>{t('Wire')}</th>
                  <th>{t('Colour')}</th>
                  <th className="num">mm²</th>
                  <th>{t('Destination')}</th>
                  <th className="num">{t('Length mm')}</th>
                </tr>
              </thead>
              <tbody>
                {pinoutRows(doc, derived).map((r, i, all) => {
                  const first = i === 0 || all[i - 1].compId !== r.compId;
                  return (
                    <tr key={i} style={first ? { borderTop: '1.2pt solid #111' } : undefined}>
                      <td>{first ? `${r.comp}${r.mate ? ` ⇄ ${r.mate}` : ''}` : ''}</td>
                      <td>{first ? r.part : ''}</td>
                      <td>{r.pin}</td>
                      <td>{r.fn}</td>
                      <td>{r.wire}</td>
                      <td>
                        {r.colorHex && <span className="print-swatch" style={{ background: r.colorHex }} />}
                        {r.color}
                      </td>
                      <td className="num">{r.cs ? fmtNum(r.cs, 2) : ''}</td>
                      <td>{r.dest}</td>
                      <td className="num">{r.length === null ? (r.wire ? '–' : '') : fmtNum(r.length, 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}

        {images && job.sections.cables && (
          <section className="print-section">
            {header(t('Cables'))}
            <h2>{t('Cables')}</h2>
            <table className="print-table">
              <thead>
                <tr>
                  <th>{t('Designation')}</th>
                  <th>{t('Kind')}</th>
                  <th>{t('Type')}</th>
                  <th>{t('Part number')}</th>
                  <th className="num">{t('Cores')}</th>
                  <th>{t('Wires')}</th>
                  <th className="num">{t('Length mm')}</th>
                </tr>
              </thead>
              <tbody>
                {cableRows(doc, derived).map((r) => (
                  <tr key={r.cableId}>
                    <td>{r.label}</td>
                    <td>{r.kind}</td>
                    <td>{r.type}</td>
                    <td>{r.part}</td>
                    <td className="num">{r.cores}</td>
                    <td>{r.members}</td>
                    <td className="num">{r.length === null ? '–' : fmtNum(r.length, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {images && job.sections.segments && (
          <section className="print-section">
            {header(t('Segments'))}
            <h2>{t('Segments')}</h2>
            <table className="print-table">
              <thead>
                <tr>
                  <th>{t('From')}</th>
                  <th>{t('To')}</th>
                  <th className="num">{t('Length mm')}</th>
                  <th className="num">{t('Wires')}</th>
                  <th className="num">{t('Bundle Ø ≈ mm')}</th>
                  <th>{t('Covering')}</th>
                  <th>{t('Wires')}</th>
                </tr>
              </thead>
              <tbody>
                {segmentRows(doc, derived).map((r) => (
                  <tr key={r.segId}>
                    <td>{r.from}</td>
                    <td>{r.to}</td>
                    <td className="num">{fmtNum(r.length, 1)}</td>
                    <td className="num">{r.wires}</td>
                    <td className="num">{r.bundle ? fmtNum(r.bundle, 1) : '–'}</td>
                    <td>{r.coverings}</td>
                    <td>{r.wireLabels}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </>
  );

  return createPortal(content, document.getElementById('print-root'));
}
