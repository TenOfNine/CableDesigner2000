import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api, downloadBlob, safeFilename, EXPORT_FORMAT, IMPORT_FORMATS } from '../api.js';
import { useAuth } from '../App.jsx';
import { Modal, useDialogs, fmtDate, Dropdown, MenuButton } from '../components/ui.jsx';
import { t } from '../i18n/index.js';

const permLabel = (p) => ({ owner: t('Owner'), write: t('Edit'), read: t('Read') })[p];

function buildTree(projects) {
  const byId = new Map(projects.map((p) => [p.id, { ...p, children: [] }]));
  const roots = [];
  for (const p of byId.values()) {
    if (p.parentId && byId.has(p.parentId)) byId.get(p.parentId).children.push(p);
    else roots.push(p);
  }
  const sort = (arr) => {
    arr.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    arr.forEach((n) => sort(n.children));
  };
  sort(roots);
  return { byId, roots };
}

export default function Dashboard() {
  const { projectId } = useParams();
  const selectedId = projectId ? Number(projectId) : null;
  const navigate = useNavigate();
  const { user } = useAuth();
  const dialogs = useDialogs();
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(() => new Set());
  const [harnesses, setHarnesses] = useState([]);
  const [shareFor, setShareFor] = useState(null);
  const [moveFor, setMoveFor] = useState(null);
  const importRef = useRef(null);

  const loadProjects = useCallback(async () => {
    try {
      setProjects((await api.get('/projects')).projects);
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const tree = useMemo(() => buildTree(projects || []), [projects]);
  const selected = selectedId ? tree.byId.get(selectedId) : null;

  const loadHarnesses = useCallback(async () => {
    if (!selectedId) return setHarnesses([]);
    try {
      setHarnesses((await api.get(`/projects/${selectedId}/harnesses`)).harnesses);
    } catch (e) {
      setError(e.message);
      setHarnesses([]);
    }
  }, [selectedId]);
  useEffect(() => {
    loadHarnesses();
  }, [loadHarnesses]);

  // Expand the path to the selected project
  useEffect(() => {
    if (!selected) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      let p = selected;
      while (p && p.parentId) {
        next.add(p.parentId);
        p = tree.byId.get(p.parentId);
      }
      return next;
    });
  }, [selected, tree]);

  const path = useMemo(() => {
    const out = [];
    let p = selected;
    while (p) {
      out.unshift(p);
      p = p.parentId ? tree.byId.get(p.parentId) : null;
    }
    return out;
  }, [selected, tree]);

  const run = async (fn) => {
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    }
  };

  const createProject = (parentId) =>
    run(async () => {
      const name = await dialogs.prompt(parentId ? t('New sub-project') : t('New project'), { label: t('Name'), okLabel: t('Create') });
      if (!name?.trim()) return;
      const res = await api.post('/projects', { name, parentId });
      setProjects(res.projects);
      navigate(`/project/${res.id}`);
    });

  const renameProject = (p) =>
    run(async () => {
      const name = await dialogs.prompt(t('Rename project'), { label: t('Name'), value: p.name, okLabel: t('Save') });
      if (!name?.trim() || name === p.name) return;
      setProjects((await api.patch(`/projects/${p.id}`, { name })).projects);
    });

  const editDescription = (p) =>
    run(async () => {
      const description = await dialogs.prompt(t('Description'), { label: t('Description'), value: p.description, multiline: true, okLabel: t('Save') });
      if (description === null) return;
      setProjects((await api.patch(`/projects/${p.id}`, { description })).projects);
    });

  const deleteProject = (p) =>
    run(async () => {
      const ok = await dialogs.confirm(t('Permanently delete project "{name}" with all sub-projects and harnesses?', { name: p.name }), {
        okLabel: t('Delete'),
        danger: true,
      });
      if (!ok) return;
      setProjects((await api.del(`/projects/${p.id}`)).projects);
      navigate(p.parentId ? `/project/${p.parentId}` : '/');
    });

  const createHarness = () =>
    run(async () => {
      const name = await dialogs.prompt(t('New harness'), { label: t('Name'), okLabel: t('Create') });
      if (!name?.trim()) return;
      const { id } = await api.post(`/projects/${selectedId}/harnesses`, { name });
      navigate(`/harness/${id}`);
    });

  const renameHarness = (h) =>
    run(async () => {
      const name = await dialogs.prompt(t('Rename harness'), { label: t('Name'), value: h.name, okLabel: t('Save') });
      if (!name?.trim() || name === h.name) return;
      await api.patch(`/harnesses/${h.id}`, { name });
      loadHarnesses();
    });

  const duplicateHarness = (h) =>
    run(async () => {
      await api.post(`/harnesses/${h.id}/duplicate`, {});
      loadHarnesses();
      loadProjects();
    });

  const deleteHarness = (h) =>
    run(async () => {
      const ok = await dialogs.confirm(t('Permanently delete harness "{name}"?', { name: h.name }), { okLabel: t('Delete'), danger: true });
      if (!ok) return;
      await api.del(`/harnesses/${h.id}`);
      loadHarnesses();
      loadProjects();
    });

  const exportJson = (h) =>
    run(async () => {
      const { harness } = await api.get(`/harnesses/${h.id}`);
      const payload = { format: EXPORT_FORMAT, formatVersion: 1, name: harness.name, description: harness.description, data: harness.data };
      downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `${safeFilename(harness.name)}.harness.json`);
    });

  const importJson = (file) =>
    run(async () => {
      const text = await file.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error(t('The file is not valid JSON.'));
      }
      if (!IMPORT_FORMATS.includes(payload?.format) || !payload.data) throw new Error(t('The file is not a CableDesigner2000 export.'));
      const { id } = await api.post(`/projects/${selectedId}/harnesses`, {
        name: payload.name || file.name.replace(/\.json$/i, ''),
        description: payload.description || '',
        data: payload.data,
      });
      navigate(`/harness/${id}`);
    });

  const canWrite = selected && (selected.permission === 'owner' || selected.permission === 'write');
  const isOwner = selected?.permission === 'owner';
  const ownRoots = tree.roots.filter((p) => p.permission === 'owner');
  const sharedRoots = tree.roots.filter((p) => p.permission !== 'owner');

  const toggle = (id) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const renderNode = (node, depth) => (
    <div key={node.id}>
      <div className={`tree-node ${node.id === selectedId ? 'selected' : ''}`} style={{ paddingLeft: 6 + depth * 14 }} onClick={() => navigate(`/project/${node.id}`)}>
        <span
          className="twisty"
          onClick={(e) => {
            e.stopPropagation();
            if (node.children.length) toggle(node.id);
          }}
        >
          {node.children.length ? (expanded.has(node.id) ? '▾' : '▸') : ''}
        </span>
        <span className="tn-name" title={node.name}>
          {node.permission !== 'owner' && depth === 0 ? '🔗 ' : ''}
          {node.name}
        </span>
        {node.harnessCount > 0 && <span className="tn-count">{node.harnessCount}</span>}
      </div>
      {expanded.has(node.id) && node.children.map((c) => renderNode(c, depth + 1))}
    </div>
  );

  return (
    <div className="dash">
      <aside className="dash-side">
        <div className="tree-title">
          <span>{t('My projects')}</span>
          <button className="ghost small" onClick={() => createProject(null)} title={t('New project')}>
            ＋
          </button>
        </div>
        {projects && ownRoots.length === 0 && <div className="muted small" style={{ padding: '0 8px' }}>{t('No projects yet.')}</div>}
        {ownRoots.map((n) => renderNode(n, 0))}
        {sharedRoots.length > 0 && (
          <>
            <div className="tree-title" style={{ marginTop: 12 }}>
              <span>{t('Shared with me')}</span>
            </div>
            {sharedRoots.map((n) => renderNode(n, 0))}
          </>
        )}
      </aside>

      <main className="dash-main">
        {error && (
          <div className="error-box" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}
        {!projects && <div className="muted">{t('Loading …')}</div>}

        {projects && !selected && (
          <div className="col" style={{ gap: 16 }}>
            <div className="row">
              <h1 className="grow">{t('Hello {name}', { name: user.displayName })}</h1>
              <button className="primary" onClick={() => createProject(null)}>
                ＋ {t('New project')}
              </button>
            </div>
            {selectedId && <div className="warn-box">{t('The project was not found or is no longer shared.')}</div>}
            {tree.roots.length === 0 ? (
              <div className="empty">{t('Create your first project. Inside a project you can create any number of sub-projects and harnesses.')}</div>
            ) : (
              <div className="card-grid">
                {tree.roots.map((p) => (
                  <ProjectTile key={p.id} p={p} onOpen={() => navigate(`/project/${p.id}`)} />
                ))}
              </div>
            )}
          </div>
        )}

        {selected && (
          <div className="col" style={{ gap: 18 }}>
            <div className="col" style={{ gap: 6 }}>
              <div className="row small muted wrap">
                <Link to="/">{t('Projects')}</Link>
                {path.map((p) => (
                  <span key={p.id} className="row" style={{ gap: 6 }}>
                    <span>›</span>
                    {p.id === selected.id ? <span>{p.name}</span> : <Link to={`/project/${p.id}`}>{p.name}</Link>}
                  </span>
                ))}
              </div>
              <div className="row wrap">
                <h1>{selected.name}</h1>
                <span className={`badge ${isOwner ? '' : 'accent'}`}>{permLabel(selected.permission)}</span>
                {!isOwner && <span className="muted small">{t('by {name}', { name: selected.ownerName })}</span>}
                <div className="spacer" />
                {canWrite && <button onClick={() => createProject(selected.id)}>＋ {t('Sub-project')}</button>}
                {canWrite && (
                  <button className="primary" onClick={createHarness}>
                    ＋ {t('Harness')}
                  </button>
                )}
                <Dropdown label="⋯" buttonClass="icon" title={t('More')}>
                  <MenuButton icon="✎" disabled={!canWrite} onClick={() => renameProject(selected)}>
                    {t('Rename')}
                  </MenuButton>
                  <MenuButton icon="¶" disabled={!canWrite} onClick={() => editDescription(selected)}>
                    {t('Edit description')}
                  </MenuButton>
                  <MenuButton icon="⇪" disabled={!canWrite} onClick={() => importRef.current?.click()}>
                    {t('Import harness (JSON)')}
                  </MenuButton>
                  <MenuButton icon="🔗" disabled={!isOwner} onClick={() => setShareFor(selected)}>
                    {t('Share …')}
                  </MenuButton>
                  <MenuButton icon="↦" disabled={!isOwner} onClick={() => setMoveFor(selected)}>
                    {t('Move …')}
                  </MenuButton>
                  <MenuButton icon="🗑" danger disabled={!isOwner} onClick={() => deleteProject(selected)}>
                    {t('Delete')}
                  </MenuButton>
                </Dropdown>
                <input
                  ref={importRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) importJson(f);
                  }}
                />
              </div>
              {selected.description && <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{selected.description}</p>}
            </div>

            {selected.children.length > 0 && (
              <section className="col">
                <h3>{t('Sub-projects')}</h3>
                <div className="card-grid">
                  {selected.children.map((p) => (
                    <ProjectTile key={p.id} p={p} onOpen={() => navigate(`/project/${p.id}`)} />
                  ))}
                </div>
              </section>
            )}

            <section className="col">
              <h3>{t('Harnesses')}</h3>
              {harnesses.length === 0 ? (
                <div className="empty">
                  {t('No harnesses in this project yet.')}
                  {canWrite && (
                    <div style={{ marginTop: 10 }}>
                      <button className="primary" onClick={createHarness}>
                        ＋ {t('Create harness')}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="card-grid">
                  {harnesses.map((h) => (
                    <div key={h.id} className="tile" onClick={() => navigate(`/harness/${h.id}`)}>
                      <div className="tile-title">
                        <span>〰</span>
                        <span className="grow">{h.name}</span>
                      </div>
                      {h.description && <div className="muted small">{h.description}</div>}
                      <div className="muted small">
                        {h.updatedByName ? t('Changed {date} by {name}', { date: fmtDate(h.updatedAt), name: h.updatedByName }) : t('Changed {date}', { date: fmtDate(h.updatedAt) })}
                      </div>
                      <div className="tile-actions" onClick={(e) => e.stopPropagation()}>
                        <button className="small" onClick={() => navigate(`/harness/${h.id}`)}>
                          {t('Open')}
                        </button>
                        <Dropdown label="⋯" buttonClass="small">
                          <MenuButton icon="✎" disabled={!canWrite} onClick={() => renameHarness(h)}>
                            {t('Rename')}
                          </MenuButton>
                          <MenuButton icon="⧉" disabled={!canWrite} onClick={() => duplicateHarness(h)}>
                            {t('Duplicate')}
                          </MenuButton>
                          <MenuButton icon="↦" disabled={!canWrite} onClick={() => setMoveFor({ harness: h })}>
                            {t('Move to another project …')}
                          </MenuButton>
                          <MenuButton icon="⇩" onClick={() => exportJson(h)}>
                            {t('Export as JSON')}
                          </MenuButton>
                          <MenuButton icon="🗑" danger disabled={!canWrite} onClick={() => deleteHarness(h)}>
                            {t('Delete')}
                          </MenuButton>
                        </Dropdown>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </main>

      {shareFor && <ShareDialog project={shareFor} onClose={() => setShareFor(null)} />}
      {moveFor && (
        <MoveDialog
          target={moveFor}
          projects={projects}
          tree={tree}
          onClose={() => setMoveFor(null)}
          onDone={async () => {
            setMoveFor(null);
            await loadProjects();
            await loadHarnesses();
          }}
        />
      )}
    </div>
  );
}

function ProjectTile({ p, onOpen }) {
  return (
    <div className="tile" onClick={onOpen}>
      <div className="tile-title">
        <span>{p.permission === 'owner' ? '📁' : '🔗'}</span>
        <span className="grow">{p.name}</span>
      </div>
      {p.description && <div className="muted small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxHeight: 36 }}>{p.description}</div>}
      <div className="muted small">
        {t('{n} sub-projects · {m} harnesses', { n: p.children.length, m: p.harnessCount })}
      </div>
      {p.permission !== 'owner' && (
        <div className="small">
          <span className="badge accent">{permLabel(p.permission)}</span> <span className="muted">{t('by {name}', { name: p.ownerName })}</span>
        </div>
      )}
    </div>
  );
}

function ShareDialog({ project, onClose }) {
  const [data, setData] = useState(null);
  const [users, setUsers] = useState([]);
  const [userId, setUserId] = useState('');
  const [permission, setPermission] = useState('read');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [shares, dir] = await Promise.all([api.get(`/projects/${project.id}/shares`), api.get('/auth/directory')]);
      setData(shares);
      setUsers(dir.users);
    } catch (e) {
      setError(e.message);
    }
  }, [project.id]);
  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    setError('');
    try {
      await api.put(`/projects/${project.id}/shares`, { userId: Number(userId), permission });
      setUserId('');
      load();
    } catch (e) {
      setError(e.message);
    }
  };
  const change = async (uid, perm) => {
    try {
      await api.put(`/projects/${project.id}/shares`, { userId: uid, permission: perm });
      load();
    } catch (e) {
      setError(e.message);
    }
  };
  const remove = async (uid) => {
    try {
      await api.del(`/projects/${project.id}/shares/${uid}`);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const sharedIds = new Set((data?.shares || []).map((s) => s.userId));
  const available = users.filter((u) => !sharedIds.has(u.id));

  return (
    <Modal title={t('Share "{name}"', { name: project.name })} onClose={onClose} footer={<button onClick={onClose}>{t('Close')}</button>}>
      <p className="muted small">
        {t('A share applies to this project including all sub-projects and harnesses. "Read" allows viewing and exporting, "Edit" additionally changing and creating.')}
      </p>
      {error && <div className="error-box">{error}</div>}
      <div className="row">
        <select className="grow" value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">{t('Choose user …')}</option>
          {available.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName} ({u.username})
            </option>
          ))}
        </select>
        <select value={permission} onChange={(e) => setPermission(e.target.value)}>
          <option value="read">{t('Read')}</option>
          <option value="write">{t('Edit')}</option>
        </select>
        <button className="primary" disabled={!userId} onClick={add}>
          {t('Add')}
        </button>
      </div>
      {data && (
        <table className="table">
          <tbody>
            {data.shares.length === 0 && (
              <tr>
                <td className="muted">{t('No shares yet.')}</td>
              </tr>
            )}
            {data.shares.map((s) => (
              <tr key={s.userId}>
                <td>
                  {s.displayName} <span className="muted small">({s.username})</span>
                </td>
                <td style={{ width: 140 }}>
                  <select className="small" value={s.permission} onChange={(e) => change(s.userId, e.target.value)}>
                    <option value="read">{t('Read')}</option>
                    <option value="write">{t('Edit')}</option>
                  </select>
                </td>
                <td style={{ width: 40 }}>
                  <button className="ghost small danger" onClick={() => remove(s.userId)} title={t('Remove share')}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data?.inherited?.length > 0 && (
        <div className="col" style={{ gap: 4 }}>
          <div className="muted small">{t('Inherited from parent projects:')}</div>
          {data.inherited.map((s, i) => (
            <div key={i} className="small">
              {s.displayName} – {permLabel(s.permission)} <span className="muted">({t('via "{name}"', { name: s.projectName })})</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function MoveDialog({ target, projects, tree, onClose, onDone }) {
  const isHarness = !!target.harness;
  const [dest, setDest] = useState('');
  const [error, setError] = useState('');

  const options = useMemo(() => {
    const out = [];
    const walk = (nodes, depth) => {
      for (const n of nodes) {
        let ok;
        if (isHarness) ok = n.permission === 'owner' || n.permission === 'write';
        else {
          ok = n.permission === 'owner' && n.ownerId === target.ownerId;
          // not into itself or one of its descendants
          let p = n;
          while (p) {
            if (p.id === target.id) ok = false;
            p = p.parentId ? tree.byId.get(p.parentId) : null;
          }
        }
        out.push({ id: n.id, label: `${'  '.repeat(depth)}${n.name}`, ok });
        walk(n.children, depth + 1);
      }
    };
    walk(tree.roots, 0);
    return out;
  }, [tree, target, isHarness]);

  const submit = async () => {
    setError('');
    try {
      if (isHarness) await api.patch(`/harnesses/${target.harness.id}`, { projectId: Number(dest) });
      else await api.patch(`/projects/${target.id}`, { parentId: dest === 'root' ? null : Number(dest) });
      onDone();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <Modal
      title={t('Move "{name}"', { name: isHarness ? target.harness.name : target.name })}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>{t('Cancel')}</button>
          <button className="primary" disabled={!dest} onClick={submit}>
            {t('Move')}
          </button>
        </>
      }
    >
      {error && <div className="error-box">{error}</div>}
      <label className="field">
        {t('Target')}
        <select value={dest} onChange={(e) => setDest(e.target.value)}>
          <option value="">{t('Please choose …')}</option>
          {!isHarness && <option value="root">{t('(top level)')}</option>}
          {options.map((o) => (
            <option key={o.id} value={o.id} disabled={!o.ok}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {projects.length === 0 && <div className="muted">{t('No projects available.')}</div>}
    </Modal>
  );
}
