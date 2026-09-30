import express from 'express';
import { db } from '../db.js';
import { requireUser } from '../auth.js';
import { projectPermission, visibleProjects, canRead, canWrite, projectChain, descendantIds } from '../access.js';
import { emptyHarness, validateHarnessData } from '../harness-data.js';

const router = express.Router();
router.use(requireUser);

const cleanName = (s) => String(s || '').trim().slice(0, 120);
const cleanDesc = (s) => String(s || '').trim().slice(0, 2000);

function loadProjectOr404(req, res, minWrite = false) {
  const id = Number(req.params.id);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  const perm = project ? projectPermission(req.user.id, id) : null;
  if (!project || !canRead(perm)) {
    res.status(404).json({ error: 'Projekt nicht gefunden.' });
    return null;
  }
  if (minWrite && !canWrite(perm)) {
    res.status(403).json({ error: 'Keine Schreibberechtigung für dieses Projekt.' });
    return null;
  }
  return { project, perm };
}

function touchProject(id) {
  db.prepare("UPDATE projects SET updated_at = datetime('now') WHERE id = ?").run(id);
}

// ---------- Projekte ----------
router.get('/projects', (req, res) => {
  res.json({ projects: visibleProjects(req.user.id) });
});

router.post('/projects', (req, res) => {
  const name = cleanName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'Bitte einen Namen angeben.' });
  const parentId = req.body?.parentId ? Number(req.body.parentId) : null;
  let ownerId = req.user.id;
  if (parentId) {
    const parent = db.prepare('SELECT * FROM projects WHERE id = ?').get(parentId);
    const perm = parent ? projectPermission(req.user.id, parentId) : null;
    if (!parent || !canWrite(perm)) return res.status(403).json({ error: 'Keine Schreibberechtigung für das übergeordnete Projekt.' });
    ownerId = parent.owner_id; // Unterprojekte gehören immer dem Eigentümer des Baums
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
    if (!name) return res.status(400).json({ error: 'Bitte einen Namen angeben.' });
    db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(name, project.id);
  }
  if (b.description !== undefined) {
    db.prepare('UPDATE projects SET description = ? WHERE id = ?').run(cleanDesc(b.description), project.id);
  }
  if (b.parentId !== undefined) {
    if (perm !== 'owner') return res.status(403).json({ error: 'Nur der Eigentümer kann Projekte verschieben.' });
    const newParent = b.parentId ? Number(b.parentId) : null;
    if (newParent) {
      const target = db.prepare('SELECT * FROM projects WHERE id = ?').get(newParent);
      if (!target || target.owner_id !== project.owner_id) {
        return res.status(400).json({ error: 'Ziel muss ein eigenes Projekt sein.' });
      }
      if (descendantIds(project.id).includes(newParent)) {
        return res.status(400).json({ error: 'Ein Projekt kann nicht in sich selbst verschoben werden.' });
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
  if (ctx.perm !== 'owner') return res.status(403).json({ error: 'Nur der Eigentümer kann Projekte löschen.' });
  db.prepare('DELETE FROM projects WHERE id = ?').run(ctx.project.id);
  res.json({ projects: visibleProjects(req.user.id) });
});

// ---------- Freigaben ----------
router.get('/projects/:id/shares', (req, res) => {
  const ctx = loadProjectOr404(req, res);
  if (!ctx) return;
  if (ctx.perm !== 'owner') return res.status(403).json({ error: 'Nur der Eigentümer kann Freigaben verwalten.' });
  const shares = db
    .prepare(
      `SELECT s.user_id AS userId, s.permission, u.username, u.display_name AS displayName
       FROM project_shares s JOIN users u ON u.id = s.user_id WHERE s.project_id = ? ORDER BY u.display_name`
    )
    .all(ctx.project.id);
  // Geerbte Freigaben von übergeordneten Projekten
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
  if (ctx.perm !== 'owner') return res.status(403).json({ error: 'Nur der Eigentümer kann Freigaben verwalten.' });
  const userId = Number(req.body?.userId);
  const permission = req.body?.permission;
  if (!['read', 'write'].includes(permission)) return res.status(400).json({ error: 'Ungültige Berechtigung.' });
  const target = db.prepare('SELECT id FROM users WHERE id = ? AND disabled = 0').get(userId);
  if (!target) return res.status(404).json({ error: 'Benutzer nicht gefunden.' });
  if (userId === ctx.project.owner_id) return res.status(400).json({ error: 'Der Eigentümer hat bereits Vollzugriff.' });
  db.prepare(
    `INSERT INTO project_shares (project_id, user_id, permission) VALUES (?, ?, ?)
     ON CONFLICT(project_id, user_id) DO UPDATE SET permission = excluded.permission`
  ).run(ctx.project.id, userId, permission);
  res.json({ ok: true });
});

router.delete('/projects/:id/shares/:userId', (req, res) => {
  const ctx = loadProjectOr404(req, res);
  if (!ctx) return;
  if (ctx.perm !== 'owner') return res.status(403).json({ error: 'Nur der Eigentümer kann Freigaben verwalten.' });
  db.prepare('DELETE FROM project_shares WHERE project_id = ? AND user_id = ?').run(ctx.project.id, Number(req.params.userId));
  res.json({ ok: true });
});

// ---------- Kabelbäume ----------
const harnessListFields = `h.id, h.project_id AS projectId, h.name, h.description, h.version,
  h.created_at AS createdAt, h.updated_at AS updatedAt, u.display_name AS updatedByName`;

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
  if (!name) return res.status(400).json({ error: 'Bitte einen Namen angeben.' });
  let data = req.body?.data;
  if (data !== undefined) {
    const err = validateHarnessData(data);
    if (err) return res.status(400).json({ error: err });
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
    res.status(404).json({ error: 'Kabelbaum nicht gefunden.' });
    return null;
  }
  if (minWrite && !canWrite(perm)) {
    res.status(403).json({ error: 'Keine Schreibberechtigung.' });
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

// Speichern des Dokuments mit optimistischer Sperre
router.put('/harnesses/:id', (req, res) => {
  const ctx = loadHarnessOr404(req, res, true);
  if (!ctx) return;
  const { data, version } = req.body || {};
  const err = validateHarnessData(data);
  if (err) return res.status(400).json({ error: err });
  const result = db
    .prepare(
      `UPDATE harnesses SET data = ?, version = version + 1, updated_at = datetime('now'), updated_by = ?
       WHERE id = ? AND version = ?`
    )
    .run(JSON.stringify(data), req.user.id, ctx.harness.id, Number(version));
  if (result.changes === 0) {
    const cur = db
      .prepare('SELECT h.version, h.updated_at, u.display_name FROM harnesses h LEFT JOIN users u ON u.id = h.updated_by WHERE h.id = ?')
      .get(ctx.harness.id);
    return res.status(409).json({
      error: `Der Kabelbaum wurde zwischenzeitlich von ${cur.display_name || 'jemand anderem'} geändert.`,
      version: cur.version,
    });
  }
  touchProject(ctx.harness.project_id);
  const cur = db.prepare('SELECT version, updated_at FROM harnesses WHERE id = ?').get(ctx.harness.id);
  res.json({ version: cur.version, updatedAt: cur.updated_at });
});

router.patch('/harnesses/:id', (req, res) => {
  const ctx = loadHarnessOr404(req, res, true);
  if (!ctx) return;
  const b = req.body || {};
  if (b.name !== undefined) {
    const name = cleanName(b.name);
    if (!name) return res.status(400).json({ error: 'Bitte einen Namen angeben.' });
    db.prepare('UPDATE harnesses SET name = ? WHERE id = ?').run(name, ctx.harness.id);
  }
  if (b.description !== undefined) {
    db.prepare('UPDATE harnesses SET description = ? WHERE id = ?').run(cleanDesc(b.description), ctx.harness.id);
  }
  if (b.projectId !== undefined) {
    const target = Number(b.projectId);
    if (!canWrite(projectPermission(req.user.id, target))) {
      return res.status(403).json({ error: 'Keine Schreibberechtigung für das Zielprojekt.' });
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
    return res.status(403).json({ error: 'Keine Schreibberechtigung für das Zielprojekt.' });
  }
  const name = cleanName(req.body?.name) || `${ctx.harness.name} (Kopie)`;
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

export default router;
