import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { seedParts, SEED_VERSION } from './seed-parts.js';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const DB_PATH = path.join(DATA_DIR, 'cabledesigner.db');

// Migration from the pre-rename file name (Harness Designer v0.1)
const LEGACY_DB = path.join(DATA_DIR, 'harness.db');
if (!fs.existsSync(DB_PATH) && fs.existsSync(LEGACY_DB)) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(LEGACY_DB + suffix)) fs.renameSync(LEGACY_DB + suffix, DB_PATH + suffix);
  }
  console.log('Renamed legacy database harness.db -> cabledesigner.db');
}

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

const MIGRATIONS = [
  // 1: base schema
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);

  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE projects (
    id INTEGER PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX projects_owner ON projects(owner_id);
  CREATE INDEX projects_parent ON projects(parent_id);

  CREATE TABLE project_shares (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission TEXT NOT NULL CHECK (permission IN ('read','write')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (project_id, user_id)
  );
  CREATE INDEX shares_user ON project_shares(user_id);

  CREATE TABLE harnesses (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX harnesses_project ON harnesses(project_id);

  CREATE TABLE parts (
    id INTEGER PRIMARY KEY,
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    part_number TEXT NOT NULL DEFAULT '',
    manufacturer TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL DEFAULT '{}',
    image BLOB,
    image_type TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX parts_owner ON parts(owner_id);
  `,
  // 2: UI language per user, revision history
  `
  ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'de';

  CREATE TABLE harness_revisions (
    id INTEGER PRIMARY KEY,
    harness_id INTEGER NOT NULL REFERENCES harnesses(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('auto','named')),
    name TEXT NOT NULL DEFAULT '',
    comment TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL,
    doc_version INTEGER NOT NULL,
    state_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX revisions_harness ON harness_revisions(harness_id, created_at);
  `,
];

function migrate() {
  const current = db.pragma('user_version', { simple: true });
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

migrate();

export function getMeta(key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : null;
}
export function setMeta(key, value) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

/**
 * Seeds / updates the global part library.
 * Every seed part carries a stable `data.seedKey`. On a new SEED_VERSION, unmodified seed parts
 * (created_at = updated_at, no image) are updated and missing ones are inserted. Parts an admin has
 * edited are left untouched.
 */
function seedLibrary() {
  const installed = Number(getMeta('seed_parts_version') || (getMeta('seed_parts_v1') ? 1 : 0));
  if (installed >= SEED_VERSION) return;
  db.transaction(() => {
    if (installed === 1) {
      // v1 seeds had no seedKey and German-only texts: replace unmodified ones
      db.prepare(
        `DELETE FROM parts WHERE owner_id IS NULL AND image IS NULL AND created_at = updated_at
         AND json_extract(data, '$.seedKey') IS NULL`
      ).run();
    }
    const find = db.prepare(
      `SELECT id, created_at = updated_at AS untouched, image IS NOT NULL AS has_image
       FROM parts WHERE owner_id IS NULL AND json_extract(data, '$.seedKey') = ?`
    );
    const insert = db.prepare(
      'INSERT INTO parts (owner_id, category, part_number, manufacturer, description, data) VALUES (NULL, ?, ?, ?, ?, ?)'
    );
    const update = db.prepare(
      `UPDATE parts SET category = ?, part_number = ?, manufacturer = ?, description = ?, data = ?,
       created_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
    );
    for (const p of seedParts) {
      const json = JSON.stringify(p.data || {});
      const row = find.get(p.data.seedKey);
      if (!row) insert.run(p.category, p.partNumber || '', p.manufacturer || '', p.description || '', json);
      else if (row.untouched && !row.has_image) update.run(p.category, p.partNumber || '', p.manufacturer || '', p.description || '', json, row.id);
    }
    setMeta('seed_parts_version', SEED_VERSION);
  })();
}

seedLibrary();
