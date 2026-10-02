import express from 'express';
import { db } from '../db.js';
import { t } from '../i18n.js';
import { requireUser } from '../auth.js';
import { projectPermission, visibleProjects, canRead, canWrite, projectChain, descendantIds } from '../access.js';
import { emptyHarness, validateHarnessData, embeddedRefs } from '../harness-data.js';

const router = express.Router();
router.use(requireUser);

const AUTO_REVISION_INTERVAL_MIN = 10;
const AUTO_REVISION_KEEP = 50;

const cleanName = (s) => String(s || '').trim().slice(0, 120);
const cleanDesc = (s) => String(s || '').trim().slice(0, 2000);

function loadProjectOr404(req, res, minWrite = false) {
  const id = Number(req.params.id);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  const perm = project ? projectPermission(req.user.id, id) : null;
  if (!project || !canRead(perm)) {
    res.status(404).json({ error: t(req, 'Project not found.') });
    return null;
  }
  if (minWrite && !canWrite(perm)) {
    res.status(403).json({ error: t(req, 'No write permission for this project.') });
    return null;
  }
  return { project, perm };
}

function touchProject(id) {
  db.prepare("UPDATE projects SET updated_at = datetime('now') WHERE id = ?").run(id);
}

function validationError(req, res, data) {
  const err = validateHarnessData(data);
  if (err) {
    res.status(400).json({ error: t(req, err.message, err.params) });
    return true;
  }
  return false;
}

/** Rejects embeddings that would form a loop. Returns an error message or null. */
function embedLoopError(req, harnessId, data) {
  const refs = embeddedRefs(data);
  if (harnessId && refs.includes(Number(harnessId))) return t(req, 'A harness cannot embed itself.');
  if (!harnessId) return null;
  const nameOf = (id) => db.prepare('SELECT name FROM harnesses WHERE id = ?').get(id)?.name || `#${id}`;
  const visited = new Set();
  const walk = (id, path, depth) => {
    if (depth > 20 || visited.has(id)) return null;
    visited.add(id);
    const row = db.prepare('SELECT data FROM harnesses WHERE id = ?').get(id);
    if (!row) return null;
    for (const child of embeddedRefs(JSON.parse(row.data))) {
      if (child === Number(harnessId)) return [...path, id, child];
      const found = walk(child, [...path, id], depth + 1);
      if (found) return found;
    }
    return null;
  };
  for (const r of refs) {
    const loop = walk(r, [Number(harnessId)], 0);
    if (loop) return t(req, 'Embedding would create a loop ({path}).', { path: loop.map(nameOf).join(' → ') });
  }
  return null;
}

// ---------- Projects ----------
router.get('/projects', (req, res) => {
  res.json({ projects: visibleProjects(req.user.id) });
});

router.post('/projects', (req, res) => {
  const name = cleanName(req.body?.name);
  if (!name) return res.status(400).json({ error: t(req, 'Please enter a name.') });
  const parentId = req.body?.parentId ? Number(req.body.parentId) : null;
  let ownerId = req.user.id;
  if (parentId) {
    const parent = db.prepare('SELECT * FROM projects WHERE id = ?').get(parentId);
    const perm = parent ? projectPermission(req.user.id, parentId) : null;
    if (!parent || !canWrite(perm)) return res.status(403).json({ error: t(req, 'No write permission for the parent project.') });
    ownerId = parent.owner_id; // sub-projects always belong to the owner of the tree
  }
  const info = db
    .prepare('INSERT INTO projects (owner_id, parent_id, name, description) VALUES (?, ?, ?, ?)')
    .run(ownerId, parentId, name, cleanDesc(req.body?.description));
  if (parentId) touchProject(parentId);
  res.json({ id: Number(info.lastInsertRowid), projects: visibleProjects(req.user.id) });
});

router.patch('/projects/:id', (req, res) => {
  const ctx = loadProjectOr404(req, res, true);
  if (!ctx) return;
  const { project, perm } = ctx;
  const b = req.body || {};
  if (b.name !== undefined) {
    const name = cleanName(b.name);
    if (!name) return res.status(400).json({ error: t(req, 'Please enter a name.') });
    db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(name, project.id);
  }
  if (b.description !== undefined) {
    db.prepare('UPDATE projects SET description = ? WHERE id = ?').run(cleanDesc(b.description), project.id);
  }
  if (b.parentId !== undefined) {
    if (perm !== 'owner') return res.status(403).json({ error: t(req, 'Only the owner can move projects.') });
    const newParent = b.parentId ? Number(b.parentId) : null;
    if (newParent) {
      const target = db.prepare('SELECT * FROM projects WHERE id = ?').get(newParent);
      if (!target || target.owner_id !== project.owner_id) {
        return res.status(400).json({ error: t(req, 'The target must be one of your own projects.') });
      }
      if (descendantIds(project.id).includes(newParent)) {
        return res.status(400).json({ error: t(req, 'A project cannot be moved into itself.') });
      }
    }
    db.prepare('UPDATE projects SET parent_id = ? WHERE id = ?').run(newParent, project.id);
  }
  touchProject(project.id);
  res.json({ projects: visibleProjects(req.user.id) });
});

router.delete('/projects/:id', (req, res) => {
  const ctx = loadProjectOr404(req, res);
  if (!ctx) return;
  if (ctx.perm !== 'owner') return res.status(403).json({ error: t(req, 'Only the owner can delete projects.') });
  db.prepare('DELETE FROM projects WHERE id = ?').run(ctx.project.id);
  res.json({ projects: visibleProjects(req.user.id) });
});

// ---------- Shares ----------
router.get('/projects/:id/shares', (req, res) => {
  const ctx = loadProjectOr404(req, res);
  if (!ctx) return;
  if (ctx.perm !== 'owner') return res.status(403).json({ error: t(req, 'Only the owner can manage shares.') });
  const shares = db
    .prepare(
      `SELECT s.user_id AS userId, s.permission, u.username, u.display_name AS displayName
       FROM project_shares s JOIN users u ON u.id = s.user_id WHERE s.project_id = ? ORDER BY u.display_name`
    )
    .all(ctx.project.id);
  // Shares inherited from parent projects
  const ancestors = projectChain(ctx.project.id).slice(1).map((c) => c.id);
  const inherited = ancestors.length
    ? db
        .prepare(
          `SELECT s.user_id AS userId, s.permission, u.display_name AS displayName, p.name AS projectName
           FROM project_shares s JOIN users u ON u.id = s.user_id JOIN projects p ON p.id = s.project_id
           WHERE s.project_id IN (${ancestors.map(() => '?').join(',')})`
        )
        .all(...ancestors)
    : [];
  res.json({ shares, inherited });
});

router.put('/projects/:id/shares', (req, res) => {
  const ctx = loadProjectOr404(req, res);
  if (!ctx) return;
  if (ctx.perm !== 'owner') return res.status(403).json({ error: t(req, 'Only the owner can manage shares.') });
  const userId = Number(req.body?.userId);
  const permission = req.body?.permission;
  if (!['read', 'write'].includes(permission)) return res.status(400).json({ error: t(req, 'Invalid permission.') });
  const target = db.prepare('SELECT id FROM users WHERE id = ? AND disabled = 0').get(userId);
  if (!target) return res.status(404).json({ error: t(req, 'User not found.') });
  if (userId === ctx.project.owner_id) return res.status(400).json({ error: t(req, 'The owner already has full access.') });
  db.prepare(
    `INSERT INTO project_shares (project_id, user_id, permission) VALUES (?, ?, ?)
     ON CONFLICT(project_id, user_id) DO UPDATE SET permission = excluded.permission`
  ).run(ctx.project.id, userId, permission);
  res.json({ ok: true });
});

router.delete('/projects/:id/shares/:userId', (req, res) => {
  const ctx = loadProjectOr404(req, res);
  if (!ctx) return;
  if (ctx.perm !== 'owner') return res.status(403).json({ error: t(req, 'Only the owner can manage shares.') });
  db.prepare('DELETE FROM project_shares WHERE project_id = ? AND user_id = ?').run(ctx.project.id, Number(req.params.userId));
  res.json({ ok: true });
});

// ---------- Harnesses ----------
const harnessListFields = `h.id, h.project_id AS projectId, h.name, h.description, h.version,
  h.created_at AS createdAt, h.updated_at AS updatedAt, u.display_name AS updatedByName`;

// All harnesses the user can read (e.g. to pick one for embedding)
router.get('/harnesses', (req, res) => {
  const projects = visibleProjects(req.user.id);
  if (!projects.length) return res.json({ harnesses: [] });
  const byId = new Map(projects.map((p) => [p.id, p]));
  const pathOf = (id) => {
    const out = [];
    let p = byId.get(id);
    while (p) {
      out.unshift(p.name);
      p = p.parentId ? byId.get(p.parentId) : null;
    }
    return out.join(' › ');
  };
  const ids = projects.map((p) => p.id);
  const rows = db
    .prepare(
      `SELECT ${harnessListFields} FROM harnesses h LEFT JOIN users u ON u.id = h.updated_by
       WHERE h.project_id IN (${ids.map(() => '?').join(',')}) ORDER BY h.name COLLATE NOCASE`
    )
    .all(...ids);
  res.json({ harnesses: rows.map((h) => ({ ...h, projectPath: pathOf(h.projectId), permission: byId.get(h.projectId).permission })) });
});

router.get('/projects/:id/harnesses', (req, res) => {
  const ctx = loadProjectOr404(req, res);
  if (!ctx) return;
  const harnesses = db
    .prepare(
      `SELECT ${harnessListFields} FROM harnesses h LEFT JOIN users u ON u.id = h.updated_by
       WHERE h.project_id = ? ORDER BY h.name COLLATE NOCASE`
    )
    .all(ctx.project.id);
  res.json({ harnesses, permission: ctx.perm });
});

router.post('/projects/:id/harnesses', (req, res) => {
  const ctx = loadProjectOr404(req, res, true);
  if (!ctx) return;
  const name = cleanName(req.body?.name);
  if (!name) return res.status(400).json({ error: t(req, 'Please enter a name.') });
  let data = req.body?.data;
  if (data !== undefined) {
    if (validationError(req, res, data)) return;
  } else {
    data = emptyHarness();
  }
  const info = db
    .prepare('INSERT INTO harnesses (project_id, name, description, data, updated_by) VALUES (?, ?, ?, ?, ?)')
    .run(ctx.project.id, name, cleanDesc(req.body?.description), JSON.stringify(data), req.user.id);
  touchProject(ctx.project.id);
  res.json({ id: Number(info.lastInsertRowid) });
});

function loadHarnessOr404(req, res, minWrite = false) {
  const h = db.prepare('SELECT * FROM harnesses WHERE id = ?').get(Number(req.params.id));
  const perm = h ? projectPermission(req.user.id, h.project_id) : null;
  if (!h || !canRead(perm)) {
    res.status(404).json({ error: t(req, 'Harness not found.') });
    return null;
  }
  if (minWrite && !canWrite(perm)) {
    res.status(403).json({ error: t(req, 'No write permission.') });
    return null;
  }
  return { harness: h, perm };
}

router.get('/harnesses/:id', (req, res) => {
  const ctx = loadHarnessOr404(req, res);
  if (!ctx) return;
  const h = ctx.harness;
  const chain = projectChain(h.project_id);
  const visible = new Set(visibleProjects(req.user.id).map((p) => p.id));
  const breadcrumb = chain
    .filter((c) => visible.has(c.id))
    .reverse()
    .map((c) => ({ id: c.id, name: db.prepare('SELECT name FROM projects WHERE id = ?').get(c.id).name }));
  const updatedBy = h.updated_by ? db.prepare('SELECT display_name FROM users WHERE id = ?').get(h.updated_by) : null;
  res.json({
    harness: {
      id: h.id,
      projectId: h.project_id,
      name: h.name,
      description: h.description,
      version: h.version,
      data: JSON.parse(h.data),
      createdAt: h.created_at,
      updatedAt: h.updated_at,
      updatedByName: updatedBy?.display_name || null,
    },
    permission: ctx.perm,
    breadcrumb,
  });
});

/**
 * All harnesses embedded (transitively) by this harness. Read access to the parent is sufficient:
 * whoever may see a harness may also see the sub-harnesses it is built from.
 */
router.get('/harnesses/:id/embeds', (req, res) => {
  const ctx = loadHarnessOr404(req, res);
  if (!ctx) return;
  const out = new Map();
  const queue = embeddedRefs(JSON.parse(ctx.harness.data));
  while (queue.length && out.size < 100) {
    const id = queue.shift();
    if (out.has(id) || id === ctx.harness.id) continue;
    const row = db.prepare('SELECT id, project_id, name, description, version, data, updated_at FROM harnesses WHERE id = ?').get(id);
    if (!row) {
      out.set(id, { id, missing: true });
      continue;
    }
    const data = JSON.parse(row.data);
    out.set(id, { id: row.id, name: row.name, description: row.description, version: row.version, updatedAt: row.updated_at, data });
    queue.push(...embeddedRefs(data));
  }
  res.json({ harnesses: [...out.values()] });
});

// Save the document with optimistic locking; creates automatic revisions
router.put('/harnesses/:id', (req, res) => {
  const ctx = loadHarnessOr404(req, res, true);
  if (!ctx) return;
  const { data, version } = req.body || {};
  if (validationError(req, res, data)) return;
  const loop = embedLoopError(req, ctx.harness.id, data);
  if (loop) return res.status(400).json({ error: loop });
  const prev = ctx.harness;
  const ok = db.transaction(() => {
    const result = db
      .prepare(
        `UPDATE harnesses SET data = ?, version = version + 1, updated_at = datetime('now'), updated_by = ?
         WHERE id = ? AND version = ?`
      )
      .run(JSON.stringify(data), req.user.id, prev.id, Number(version));
    if (result.changes === 0) return false;
    maybeAutoRevision(prev);
    return true;
  })();
  if (!ok) {
    const cur = db
      .prepare('SELECT h.version, h.updated_at, u.display_name FROM harnesses h LEFT JOIN users u ON u.id = h.updated_by WHERE h.id = ?')
      .get(prev.id);
    return res.status(409).json({
      error: t(req, 'The harness was changed in the meantime by {name}.', { name: cur.display_name || t(req, 'someone else') }),
      version: cur.version,
    });
  }
  touchProject(prev.project_id);
  const cur = db.prepare('SELECT version, updated_at FROM harnesses WHERE id = ?').get(prev.id);
  res.json({ version: cur.version, updatedAt: cur.updated_at });
});

/** Keeps the previous state as an automatic revision, at most every AUTO_REVISION_INTERVAL_MIN minutes */
function maybeAutoRevision(prev) {
  const prevData = JSON.parse(prev.data);
  if (!prevData.components?.length && !prevData.wires?.length) return;
  const last = db
    .prepare(
      `SELECT (julianday('now') - julianday(created_at)) * 1440 AS age FROM harness_revisions
       WHERE harness_id = ? AND kind = 'auto' ORDER BY id DESC LIMIT 1`
    )
    .get(prev.id);
  if (last && last.age < AUTO_REVISION_INTERVAL_MIN) return;
  db.prepare(
    `INSERT INTO harness_revisions (harness_id, kind, data, doc_version, state_at, created_by) VALUES (?, 'auto', ?, ?, ?, ?)`
  ).run(prev.id, prev.data, prev.version, prev.updated_at, prev.updated_by);
  db.prepare(
    `DELETE FROM harness_revisions WHERE harness_id = ? AND kind = 'auto' AND id NOT IN
     (SELECT id FROM harness_revisions WHERE harness_id = ? AND kind = 'auto' ORDER BY id DESC LIMIT ?)`
  ).run(prev.id, prev.id, AUTO_REVISION_KEEP);
}

router.patch('/harnesses/:id', (req, res) => {
  const ctx = loadHarnessOr404(req, res, true);
  if (!ctx) return;
  const b = req.body || {};
  if (b.name !== undefined) {
    const name = cleanName(b.name);
    if (!name) return res.status(400).json({ error: t(req, 'Please enter a name.') });
    db.prepare('UPDATE harnesses SET name = ? WHERE id = ?').run(name, ctx.harness.id);
  }
  if (b.description !== undefined) {
    db.prepare('UPDATE harnesses SET description = ? WHERE id = ?').run(cleanDesc(b.description), ctx.harness.id);
  }
  if (b.projectId !== undefined) {
    const target = Number(b.projectId);
    if (!canWrite(projectPermission(req.user.id, target))) {
      return res.status(403).json({ error: t(req, 'No write permission for the target project.') });
    }
    db.prepare('UPDATE harnesses SET project_id = ? WHERE id = ?').run(target, ctx.harness.id);
    touchProject(target);
  }
  touchProject(ctx.harness.project_id);
  res.json({ ok: true });
});

router.post('/harnesses/:id/duplicate', (req, res) => {
  const ctx = loadHarnessOr404(req, res);
  if (!ctx) return;
  const targetProject = req.body?.projectId ? Number(req.body.projectId) : ctx.harness.project_id;
  if (!canWrite(projectPermission(req.user.id, targetProject))) {
    return res.status(403).json({ error: t(req, 'No write permission for the target project.') });
  }
  const name = cleanName(req.body?.name) || t(req, '{name} (copy)', { name: ctx.harness.name });
  const info = db
    .prepare('INSERT INTO harnesses (project_id, name, description, data, updated_by) VALUES (?, ?, ?, ?, ?)')
    .run(targetProject, name, ctx.harness.description, ctx.harness.data, req.user.id);
  touchProject(targetProject);
  res.json({ id: Number(info.lastInsertRowid) });
});

router.delete('/harnesses/:id', (req, res) => {
  const ctx = loadHarnessOr404(req, res, true);
  if (!ctx) return;
  db.prepare('DELETE FROM harnesses WHERE id = ?').run(ctx.harness.id);
  touchProject(ctx.harness.project_id);
  res.json({ ok: true });
});

// ---------- Revisions ----------
function revisionDto(r) {
  let counts = null;
  try {
    const d = JSON.parse(r.data);
    counts = { components: d.components?.length || 0, wires: d.wires?.length || 0, segments: d.segments?.length || 0 };
  } catch {
    /* ignore */
  }
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    comment: r.comment,
    docVersion: r.doc_version,
    stateAt: r.state_at || r.created_at,
    createdAt: r.created_at,
    createdByName: r.created_by_name || null,
    counts,
  };
}

router.get('/harnesses/:id/revisions', (req, res) => {
  const ctx = loadHarnessOr404(req, res);
  if (!ctx) return;
  const rows = db
    .prepare(
      `SELECT r.*, u.display_name AS created_by_name FROM harness_revisions r
       LEFT JOIN users u ON u.id = r.created_by WHERE r.harness_id = ? ORDER BY r.id DESC`
    )
    .all(ctx.harness.id);
  res.json({ revisions: rows.map(revisionDto) });
});

router.get('/harnesses/:id/revisions/:rid', (req, res) => {
  const ctx = loadHarnessOr404(req, res);
  if (!ctx) return;
  const r = db
    .prepare(
      `SELECT r.*, u.display_name AS created_by_name FROM harness_revisions r
       LEFT JOIN users u ON u.id = r.created_by WHERE r.id = ? AND r.harness_id = ?`
    )
    .get(Number(req.params.rid), ctx.harness.id);
  if (!r) return res.status(404).json({ error: t(req, 'Revision not found.') });
  res.json({ revision: { ...revisionDto(r), data: JSON.parse(r.data) } });
});

// Named revision of the current state
router.post('/harnesses/:id/revisions', (req, res) => {
  const ctx = loadHarnessOr404(req, res, true);
  if (!ctx) return;
  const name = cleanName(req.body?.name);
  if (!name) return res.status(400).json({ error: t(req, 'Please enter a name for the revision.') });
  const h = db.prepare('SELECT * FROM harnesses WHERE id = ?').get(ctx.harness.id);
  const info = db
    .prepare(
      `INSERT INTO harness_revisions (harness_id, kind, name, comment, data, doc_version, state_at, created_by)
       VALUES (?, 'named', ?, ?, ?, ?, ?, ?)`
    )
    .run(h.id, name, cleanDesc(req.body?.comment), h.data, h.version, h.updated_at, req.user.id);
  res.json({ id: Number(info.lastInsertRowid) });
});

router.patch('/harnesses/:id/revisions/:rid', (req, res) => {
  const ctx = loadHarnessOr404(req, res, true);
  if (!ctx) return;
  const r = db.prepare('SELECT * FROM harness_revisions WHERE id = ? AND harness_id = ?').get(Number(req.params.rid), ctx.harness.id);
  if (!r) return res.status(404).json({ error: t(req, 'Revision not found.') });
  const name = req.body?.name !== undefined ? cleanName(req.body.name) : r.name;
  const comment = req.body?.comment !== undefined ? cleanDesc(req.body.comment) : r.comment;
  // Naming an automatic revision turns it into a permanent named one
  const kind = name ? 'named' : r.kind;
  db.prepare('UPDATE harness_revisions SET name = ?, comment = ?, kind = ? WHERE id = ?').run(name, comment, kind, r.id);
  res.json({ ok: true });
});

router.delete('/harnesses/:id/revisions/:rid', (req, res) => {
  const ctx = loadHarnessOr404(req, res, true);
  if (!ctx) return;
  db.prepare('DELETE FROM harness_revisions WHERE id = ? AND harness_id = ?').run(Number(req.params.rid), ctx.harness.id);
  res.json({ ok: true });
});

router.post('/harnesses/:id/revisions/:rid/restore', (req, res) => {
  const ctx = loadHarnessOr404(req, res, true);
  if (!ctx) return;
  const r = db.prepare('SELECT * FROM harness_revisions WHERE id = ? AND harness_id = ?').get(Number(req.params.rid), ctx.harness.id);
  if (!r) return res.status(404).json({ error: t(req, 'Revision not found.') });
  const label = r.name || r.state_at || r.created_at;
  const loop = embedLoopError(req, ctx.harness.id, JSON.parse(r.data));
  if (loop) return res.status(400).json({ error: loop });
  db.transaction(() => {
    const h = db.prepare('SELECT * FROM harnesses WHERE id = ?').get(ctx.harness.id);
    db.prepare(
      `INSERT INTO harness_revisions (harness_id, kind, name, data, doc_version, state_at, created_by)
       VALUES (?, 'auto', ?, ?, ?, ?, ?)`
    ).run(h.id, t(req, 'Automatic backup before restoring "{name}"', { name: label }), h.data, h.version, h.updated_at, h.updated_by);
    db.prepare(
      `UPDATE harnesses SET data = ?, version = version + 1, updated_at = datetime('now'), updated_by = ? WHERE id = ?`
    ).run(r.data, req.user.id, h.id);
  })();
  touchProject(ctx.harness.project_id);
  const cur = db.prepare('SELECT version FROM harnesses WHERE id = ?').get(ctx.harness.id);
  res.json({ version: cur.version });
});

export default router;
