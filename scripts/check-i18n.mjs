#!/usr/bin/env node
// Checks the German UI dictionary (client/src/i18n/de.js) against all t('…') calls in the client.
// Reports missing translations, unused entries and placeholder mismatches. Exit code 1 on problems.
// Run from the repository root: node scripts/check-i18n.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'client', 'src');

// Strings that are translated indirectly (t(variable)) and therefore not found by the extraction
const INDIRECT = [
  'Ring terminal', 'Fork terminal', 'Ferrule', 'Tab (male quick connect)', 'Receptacle (female quick connect)',
  'Loose wire end', 'Corrugated tube', 'Tape', 'Braided sleeve', 'Heat shrink', 'Other', 'Diode', 'Resistor',
  'Unknown category "{c}".', 'Part number or description missing.', 'Number of cavities missing.',
];

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.(js|jsx)$/.test(e.name) ? [p] : [];
  });
}

const pattern = /\bt\(\s*'((?:[^'\\]|\\.)*)'/g;
const keys = new Set();
for (const f of files(srcDir).sort()) {
  if (f.endsWith(path.join('i18n', 'de.js'))) continue;
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(pattern)) keys.add(m[1].replace(/\\n/g, '\n').replace(/\\'/g, "'"));
}
for (const k of INDIRECT) keys.add(k);

const de = (await import(pathToFileURL(path.join(srcDir, 'i18n', 'de.js')).href)).default;
const missing = [...keys].filter((k) => !(k in de));
const unused = Object.keys(de).filter((k) => !keys.has(k));
const placeholders = [...keys].filter((k) => {
  if (!de[k]) return false;
  const a = (k.match(/\{\w+\}/g) || []).sort().join();
  const b = (de[k].match(/\{\w+\}/g) || []).sort().join();
  return a !== b;
});

console.log(`keys ${keys.size}, dictionary ${Object.keys(de).length}, missing ${missing.length}, unused ${unused.length}, placeholder mismatches ${placeholders.length}`);
for (const k of missing) console.log('MISSING', JSON.stringify(k));
for (const k of unused) console.log('UNUSED', JSON.stringify(k));
for (const k of placeholders) console.log('PLACEHOLDER', JSON.stringify(k));
process.exit(missing.length || unused.length || placeholders.length ? 1 : 0);
