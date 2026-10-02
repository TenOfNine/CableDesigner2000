import { db } from './db.js';

const RANK = { read: 1, write: 2, owner: 3 };

export function canRead(p) {
  return !!p && RANK[p] >= 1;
}
export function canWrite(p) {
  return !!p && RANK[p] >= 2;
}

const chainStmt = db.prepare(`
  WITH RECURSIVE chain(id, parent_id, owner_id, depth) AS (
    SELECT id, parent_id, owner_id, 0 FROM projects WHERE id = ?
    UNION ALL
    SELECT p.id, p.parent_id, p.owner_id, c.depth + 1 FROM projects p JOIN chain c ON p.id = c.parent_id
  )
  SELECT id, parent_id, owner_id, depth FROM chain ORDER BY depth
`);

/** Returns the chain project → … → root */
export function projectChain(projectId) {
  return chainStmt.all(projectId);
}

/**
 * Permission of a user on a project: 'owner' | 'write' | 'read' | null.
 * A share applies to the shared project and all of its sub-projects.
 */
export function projectPermission(userId, projectId) {
  const chain = projectChain(projectId);
  if (!chain.length) return null;
  if (chain[0].owner_id === userId) return 'owner';
  const ids = chain.map((c) => c.id);
  const rows = db
    .prepare(`SELECT permission FROM project_shares WHERE user_id = ? AND project_id IN (${ids.map(() => '?').join(',')})`)
    .all(userId, ...ids);
  let best = null;
  for (const r of rows) if (!best || RANK[r.permission] > RANK[best]) best = r.permission;
  return best;
}

/** All projects visible to the user (own + shared, including sub-projects) */
export function visibleProjects(userId) {
  const own = db
    .prepare(
      `SELECT p.id, p.parent_id, p.owner_id, p.name, p.description, p.created_at, p.updated_at,
              u.display_name AS owner_name
       FROM projects p JOIN users u ON u.id = p.owner_id WHERE p.owner_id = ?`
    )
    .all(userId)
    .map((p) => ({ ...p, permission: 'owner', shared_root: 0 }));

  // Shared subtrees
  const shared = db
    .prepare(
      `WITH RECURSIVE tree(id, root_id, permission) AS (
         SELECT s.project_id, s.project_id, s.permission FROM project_shares s WHERE s.user_id = ?
         UNION ALL
         SELECT p.id, t.root_id, t.permission FROM projects p JOIN tree t ON p.parent_id = t.id
       )
       SELECT p.id, p.parent_id, p.owner_id, p.name, p.description, p.created_at, p.updated_at,
              u.display_name AS owner_name, t.permission, (t.id = t.root_id) AS shared_root
       FROM tree t JOIN projects p ON p.id = t.id JOIN users u ON u.id = p.owner_id
       WHERE p.owner_id != ?`
    )
    .all(userId, userId);

  const map = new Map();
  for (const p of own) map.set(p.id, p);
  for (const p of shared) {
    const existing = map.get(p.id);
    if (!existing || RANK[p.permission] > RANK[existing.permission]) map.set(p.id, p);
  }
  // Invisible parents are cut off (shared roots appear at the top level)
  const result = [...map.values()].map((p) => {
    const parentVisible = p.parent_id && map.has(p.parent_id);
    return {
      ...p,
      parent_id: parentVisible ? p.parent_id : null,
      shared_root: p.permission !== 'owner' && !parentVisible ? 1 : 0,
    };
  });

  const counts = db
    .prepare(
      `SELECT project_id, COUNT(*) AS n, MAX(updated_at) AS last FROM harnesses GROUP BY project_id`
    )
    .all();
  const countMap = new Map(counts.map((c) => [c.project_id, c]));
  return result.map((p) => ({
    id: p.id,
    parentId: p.parent_id,
    ownerId: p.owner_id,
    ownerName: p.owner_name,
    name: p.name,
    description: p.description,
    permission: p.permission,
    sharedRoot: !!p.shared_root,
    harnessCount: countMap.get(p.id)?.n || 0,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  }));
}

/** All descendant ids (including the project itself) */
export function descendantIds(projectId) {
  return db
    .prepare(
      `WITH RECURSIVE d(id) AS (SELECT ? UNION ALL SELECT p.id FROM projects p JOIN d ON p.parent_id = d.id)
       SELECT id FROM d`
    )
    .all(projectId)
    .map((r) => r.id);
}
