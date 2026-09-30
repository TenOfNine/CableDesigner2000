import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { LIGHT } from './theme.js';
import { Scene, sceneBounds, loadImages } from './exports.jsx';
import { wireListRows, pinoutRows, segmentRows, bomRows } from './tables.js';
import { fmtNum, fmtCs } from './model.js';

const PAPER = { A4: [297, 210], A3: [420, 297] };
const MARGIN = 10;

/**
 * Rendert die Druckinhalte in #print-root und öffnet den Druckdialog.
 * job: { paper, orientation, sections: { schematic, layout, wires, bom, pinout, segments } }
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
    const t = setTimeout(() => window.print(), 300);
    return () => {
      clearTimeout(t);
      window.removeEventListener('afterprint', after);
    };
  }, [images, onDone]);

  const [pw, ph] = PAPER[job.paper] || PAPER.A4;
  const landscape = job.orientation !== 'portrait';
  const W = landscape ? pw : ph;
  const H = landscape ? ph : pw;
  const pageH = H - 2 * MARGIN - 1;
  const s = doc.settings;
  const date = new Date().toLocaleDateString('de-DE');
  const project = (meta.breadcrumb || []).map((b) => b.name).join(' › ');
  const drawings = [job.sections.schematic && 'schematic', job.sections.layout && 'layout'].filter(Boolean);
  const titles = { schematic: 'Schaltplan', layout: 'Layout / Formboard' };

  const header = (title) => (
    <div className="print-head">
      <span>
        <strong>{meta.name}</strong> — {title}
      </span>
      <span>
        {s.drawingNumber ? `Zeichnung ${s.drawingNumber} · ` : ''}Rev. {s.revision || '–'} · {date}
      </span>
    </div>
  );

  const content = (
    <>
    <style>{`@page { size: ${job.paper} ${landscape ? 'landscape' : 'portrait'}; margin: ${MARGIN}mm; }`}</style>
    <div className="print-doc">
      {images &&
        drawings.map((view, i) => {
          const vb = sceneBounds(view, doc, derived);
          return (
            <div key={view} className="print-page" style={{ height: `${pageH}mm` }}>
              <div className="print-drawing">
                <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
                  <Scene view={view} doc={doc} derived={derived} theme={LIGHT} images={images} />
                </svg>
              </div>
              <div className="print-title">
                <div>
                  <div className="lbl">Kabelbaum</div>
                  <div className="val">{meta.name}</div>
                </div>
                <div>
                  <div className="lbl">Projekt</div>
                  <div className="val">{project}</div>
                </div>
                <div>
                  <div className="lbl">Zeichnungsnummer</div>
                  <div className="val">{s.drawingNumber || '–'}</div>
                </div>
                <div>
                  <div className="lbl">Revision</div>
                  <div className="val">{s.revision || '–'}</div>
                </div>
                <div>
                  <div className="lbl">Bearbeiter / Datum</div>
                  <div className="val">
                    {s.author || author} · {date}
                  </div>
                </div>
                <div>
                  <div className="lbl">{titles[view]}</div>
                  <div className="val">
                    Blatt {i + 1} / {drawings.length}
                  </div>
                </div>
              </div>
            </div>
          );
        })}

      {images && job.sections.wires && (
        <section className="print-section">
          {header('Leitungsliste')}
          <h2>Leitungsliste</h2>
          <table className="print-table">
            <thead>
              <tr>
                <th>Nr.</th>
                <th>Signal</th>
                <th>Von</th>
                <th>Pin</th>
                <th>Nach</th>
                <th>Pin</th>
                <th>Farbe</th>
                <th className="num">mm²</th>
                <th>Typ</th>
                <th className="num">Länge mm</th>
                <th>Bemerkung</th>
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
                  <td className="num">{r.length === null ? '–' : fmtNum(r.length, 0)}</td>
                  <td>{r.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: '7.5pt', color: '#555', marginTop: '2mm' }}>
            Längen inkl. Zugaben: Zuschlag {fmtNum(s.extraPercent)} %, je Leitungsende {fmtNum(s.extraPerEnd)} mm.
          </p>
        </section>
      )}

      {images && job.sections.bom && (
        <section className="print-section">
          {header('Stückliste')}
          <h2>Stückliste</h2>
          <table className="print-table">
            <thead>
              <tr>
                <th className="num">Pos.</th>
                <th>Teilenummer</th>
                <th>Hersteller</th>
                <th>Beschreibung</th>
                <th className="num">Menge</th>
                <th>Einheit</th>
                <th>Verwendung</th>
              </tr>
            </thead>
            <tbody>
              {bomRows(derived).map((r) => (
                <tr key={r.pos}>
                  <td className="num">{r.pos}</td>
                  <td>{r.partNumber || '—'}</td>
                  <td>{r.manufacturer}</td>
                  <td>
                    {r.description}
                    {r.notes ? ` (${r.notes})` : ''}
                  </td>
                  <td className="num">{r.unit === 'm' ? fmtNum(r.qty, 2) : r.qty}</td>
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
          {header('Pinbelegung')}
          <h2>Pinbelegung</h2>
          <table className="print-table">
            <thead>
              <tr>
                <th>Bauteil</th>
                <th>Teil</th>
                <th>Pin</th>
                <th>Funktion</th>
                <th>Leitung</th>
                <th>Farbe</th>
                <th className="num">mm²</th>
                <th>Ziel</th>
                <th className="num">Länge mm</th>
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

      {images && job.sections.segments && (
        <section className="print-section">
          {header('Segmente')}
          <h2>Segmente</h2>
          <table className="print-table">
            <thead>
              <tr>
                <th>Von</th>
                <th>Nach</th>
                <th className="num">Länge mm</th>
                <th className="num">Leitungen</th>
                <th className="num">Bündel-Ø ≈ mm</th>
                <th>Ummantelung</th>
                <th>Leitungen</th>
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

export { fmtCs };
