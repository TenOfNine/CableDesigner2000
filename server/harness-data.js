// Minimal server-side validation of the harness document.
// The domain logic (routing, lengths, lists) lives in the client.

export const SCHEMA_VERSION = 2;

export function emptyHarness() {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: {
      drawingNumber: '',
      revision: 'A',
      author: '',
      extraPerEnd: 0,
      extraPercent: 0,
      defaultCrossSection: 0.5,
      defaultWireType: 'FLRY-B',
      defaultColor: 'BK',
    },
    components: [],
    wires: [],
    cables: [],
    nodes: [],
    segments: [],
    notes: [],
  };
}

const REQUIRED_ARRAYS = ['components', 'wires', 'nodes', 'segments', 'notes'];

/** Returns null or an error { message, params } with an English message */
export function validateHarnessData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { message: 'Invalid document.' };
  if (typeof data.schemaVersion !== 'number') return { message: 'Document without schema version.' };
  if (data.schemaVersion > SCHEMA_VERSION) return { message: 'The document was created by a newer program version.' };
  for (const key of REQUIRED_ARRAYS) {
    if (!Array.isArray(data[key])) return { message: 'Incomplete document: "{key}" is missing.', params: { key } };
  }
  if (data.cables !== undefined && !Array.isArray(data.cables)) return { message: 'Incomplete document: "{key}" is missing.', params: { key: 'cables' } };
  if (!data.settings || typeof data.settings !== 'object') return { message: 'Incomplete document: "{key}" is missing.', params: { key: 'settings' } };
  return null;
}

/** Ids of harnesses embedded (linked) by this document */
export function embeddedRefs(data) {
  const out = new Set();
  for (const c of data?.components || []) {
    if (c && c.type === 'subharness' && Number.isInteger(Number(c.ref?.harnessId))) out.add(Number(c.ref.harnessId));
  }
  return [...out];
}
