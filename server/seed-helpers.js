// Shared helpers for the built-in part library (seed-parts.js, seed-vehicle.js, seed-industrial.js).
// Kept in a separate module so the seed modules do not import each other in a cycle.

export const GRAY = { name: 'Grey', nameDe: 'Grau', hex: '#8a8f98' };
export const BLACK = { name: 'Black', nameDe: 'Schwarz', hex: '#2a2a2a' };
export const NATURAL = { name: 'Natural', nameDe: 'Natur', hex: '#e8e2cf' };
export const CHECK = 'Cavity layout is schematic – verify against the datasheet before production.';
export const CHECK_DE = 'Kammeranordnung schematisch – vor Fertigung mit Datenblatt abgleichen.';
export const GENERIC = 'Generic entry without a verified part number – set the number of cavities and the part number to match the actual housing.';
export const GENERIC_DE = 'Generischer Eintrag ohne verifizierte Teilenummer – Kammerzahl und Teilenummer an das tatsächliche Gehäuse anpassen.';

/** Helper for connector entries */
export function conn(key, pn, mfr, desc, descDe, data) {
  return {
    category: 'connector',
    partNumber: pn,
    manufacturer: mfr,
    description: desc,
    data: { seedKey: key, descriptionDe: descDe, designation: 'numeric', numbering: 'rowwise', notes: CHECK, notesDe: CHECK_DE, ...data },
  };
}

/**
 * Connector entry from the researched connector tables (seed-vehicle.js, seed-industrial.js).
 * r: { key, pn, mfr, desc, descDe, series, cavities, rows, gender, sealed, contact, range, seal, lock, mating, pitch,
 *      app, appDe, usedBy, oem, names, url, note, noteDe, generic }
 */
export function researched(r) {
  const data = {
    series: r.series,
    cavities: r.cavities,
    rows: r.rows || 1,
    gender: r.gender,
    sealed: !!r.sealed,
  };
  const opt = {
    contactPart: r.contact, contactRange: r.range, sealPart: r.seal, lockPart: r.lock, matingPart: r.mating, pitch: r.pitch,
    application: r.app, applicationDe: r.appDe, url: r.url,
  };
  for (const [k, v] of Object.entries(opt)) if (v) data[k] = v;
  if (r.usedBy?.length) data.usedBy = r.usedBy;
  if (r.oem?.length) data.oemNumbers = r.oem;
  if (r.names?.length) {
    data.designation = 'custom';
    data.designations = r.names;
  }
  data.notes = [r.generic && GENERIC, r.note, CHECK].filter(Boolean).join(' ');
  data.notesDe = [r.generic && GENERIC_DE, r.noteDe || r.note, CHECK_DE].filter(Boolean).join(' ');
  return conn(r.key, r.pn || '', r.mfr || '', r.desc, r.descDe, data);
}
