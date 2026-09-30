// Serverseitige Minimalprüfung des Kabelbaum-Dokuments.
// Die fachliche Logik (Routing, Längen, Listen) liegt im Client.

export const SCHEMA_VERSION = 1;

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
    nodes: [],
    segments: [],
    notes: [],
  };
}

const ARRAYS = ['components', 'wires', 'nodes', 'segments', 'notes'];

export function validateHarnessData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'Ungültiges Dokument.';
  if (typeof data.schemaVersion !== 'number') return 'Dokument ohne Schema-Version.';
  if (data.schemaVersion > SCHEMA_VERSION) return 'Das Dokument stammt aus einer neueren Programmversion.';
  for (const key of ARRAYS) {
    if (!Array.isArray(data[key])) return `Dokument unvollständig: "${key}" fehlt.`;
  }
  if (!data.settings || typeof data.settings !== 'object') return 'Dokument unvollständig: "settings" fehlt.';
  return null;
}
