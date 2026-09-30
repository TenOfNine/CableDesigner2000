import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api, downloadBlob, safeFilename } from '../api.js';
import { useAuth } from '../App.jsx';
import { Modal, useDialogs, fmtDate, Dropdown, MenuButton } from '../components/ui.jsx';

const PERM_LABEL = { owner: 'Eigentümer', write: 'Bearbeiten', read: 'Lesen' };

function buildTree(projects) {
  const byId = new Map(projects.map((p) => [p.id, { ...p, children: [] }]));
  const roots = [];
  for (const p of byId.values()) {
    if (p.parentId && byId.has(p.parentId)) byId.get(p.parentId).children.push(p);
    else roots.push(p);
  }
  const sort = (arr) => {
    arr.sort((a, b) => a.name.localeCompare(b.name, 'de'));
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
      const { projects } = await api.get('/projects');
      setProjects(projects);
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
      const { harnesses } = await api.get(`/projects/${selectedId}/harnesses`);
      setHarnesses(harnesses);
    } catch (e) {
      setError(e.message);
      setHarnesses([]);
    }
  }, [selectedId]);
  useEffect(() => {
    loadHarnesses();
  }, [loadHarnesses]);

  // Pfad zum ausgewählten Projekt aufklappen
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
      const name = await dialogs.prompt(parentId ? 'Neues Unterprojekt' : 'Neues Projekt', { label: 'Name', okLabel: 'Anlegen' });
      if (!name?.trim()) return;
      const res = await api.post('/projects', { name, parentId });
      setProjects(res.projects);
      navigate(`/project/${res.id}`);
    });

  const renameProject = (p) =>
    run(async () => {
      const name = await dialogs.prompt('Projekt umbenennen', { label: 'Name', value: p.name, okLabel: 'Speichern' });
      if (!name?.trim() || name === p.name) return;
      setProjects((await api.patch(`/projects/${p.id}`, { name })).projects);
    });

  const editDescription = (p) =>
    run(async () => {
      const description = await dialogs.prompt('Beschreibung', { label: 'Beschreibung', value: p.description, multiline: true, okLabel: 'Speichern' });
      if (description === null) return;
      setProjects((await api.patch(`/projects/${p.id}`, { description })).projects);
    });

  const deleteProject = (p) =>
    run(async () => {
      const ok = await dialogs.confirm(
        `Projekt „${p.name}“ mit allen Unterprojekten und Kabelbäumen endgültig löschen?`,
        { okLabel: 'Löschen', danger: true }
      );
      if (!ok) return;
      setProjects((await api.del(`/projects/${p.id}`)).projects);
      navigate(p.parentId ? `/project/${p.parentId}` : '/');
    });

  const createHarness = () =>
    run(async () => {
      const name = await dialogs.prompt('Neuer Kabelbaum', { label: 'Name', okLabel: 'Anlegen' });
      if (!name?.trim()) return;
      const { id } = await api.post(`/projects/${selectedId}/harnesses`, { name });
      navigate(`/harness/${id}`);
    });

  const renameHarness = (h) =>
    run(async () => {
      const name = await dialogs.prompt('Kabelbaum umbenennen', { label: 'Name', value: h.name, okLabel: 'Speichern' });
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
      const ok = await dialogs.confirm(`Kabelbaum „${h.name}“ endgültig löschen?`, { okLabel: 'Löschen', danger: true });
      if (!ok) return;
      await api.del(`/harnesses/${h.id}`);
      loadHarnesses();
      loadProjects();
    });

  const exportJson = (h) =>
    run(async () => {
      const { harness } = await api.get(`/harnesses/${h.id}`);
      const payload = { format: 'harness-designer', formatVersion: 1, name: harness.name, description: harness.description, data: harness.data };
      downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `${safeFilename(harness.name)}.harness.json`);
    });

  const importJson = (file) =>
    run(async () => {
      const text = await file.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error('Die Datei ist kein gültiges JSON.');
      }
      if (payload?.format !== 'harness-designer' || !payload.data) throw new Error('Die Datei ist kein Harness-Designer-Export.');
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
      <div
        className={`tree-node ${node.id === selectedId ? 'selected' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={() => navigate(`/project/${node.id}`)}
      >
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
          <span>Meine Projekte</span>
          <button className="ghost small" onClick={() => createProject(null)} title="Neues Projekt">
            ＋
          </button>
        </div>
        {projects && ownRoots.length === 0 && <div className="muted small" style={{ padding: '0 8px' }}>Noch keine Projekte.</div>}
        {ownRoots.map((n) => renderNode(n, 0))}
        {sharedRoots.length > 0 && (
          <>
            <div className="tree-title" style={{ marginTop: 12 }}>
              <span>Mit mir geteilt</span>
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
        {!projects && <div className="muted">Lade …</div>}

        {projects && !selected && (
          <div className="col" style={{ gap: 16 }}>
            <div className="row">
              <h1 className="grow">Hallo {user.displayName}</h1>
              <button className="primary" onClick={() => createProject(null)}>
                ＋ Neues Projekt
              </button>
            </div>
            {selectedId && <div className="warn-box">Das Projekt wurde nicht gefunden oder ist nicht mehr freigegeben.</div>}
            {tree.roots.length === 0 ? (
              <div className="empty">
                Lege dein erstes Projekt an. Innerhalb eines Projekts kannst du beliebig viele Unterprojekte und Kabelbäume anlegen.
              </div>
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
                <Link to="/">Projekte</Link>
                {path.map((p) => (
                  <span key={p.id} className="row" style={{ gap: 6 }}>
                    <span>›</span>
                    {p.id === selected.id ? <span>{p.name}</span> : <Link to={`/project/${p.id}`}>{p.name}</Link>}
                  </span>
                ))}
              </div>
              <div className="row wrap">
                <h1>{selected.name}</h1>
                <span className={`badge ${isOwner ? '' : 'accent'}`}>{PERM_LABEL[selected.permission]}</span>
                {!isOwner && <span className="muted small">von {selected.ownerName}</span>}
                <div className="spacer" />
                {canWrite && (
                  <button onClick={() => createProject(selected.id)} title="Unterprojekt anlegen">
                    ＋ Unterprojekt
                  </button>
                )}
                {canWrite && (
                  <button className="primary" onClick={createHarness}>
                    ＋ Kabelbaum
                  </button>
                )}
                <Dropdown label="⋯" buttonClass="icon">
                  <MenuButton icon="✎" disabled={!canWrite} onClick={() => renameProject(selected)}>
                    Umbenennen
                  </MenuButton>
                  <MenuButton icon="¶" disabled={!canWrite} onClick={() => editDescription(selected)}>
                    Beschreibung bearbeiten
                  </MenuButton>
                  <MenuButton icon="⇪" disabled={!canWrite} onClick={() => importRef.current?.click()}>
                    Kabelbaum importieren (JSON)
                  </MenuButton>
                  <MenuButton icon="🔗" disabled={!isOwner} onClick={() => setShareFor(selected)}>
                    Freigeben …
                  </MenuButton>
                  <MenuButton icon="↦" disabled={!isOwner} onClick={() => setMoveFor(selected)}>
                    Verschieben …
                  </MenuButton>
                  <MenuButton icon="🗑" danger disabled={!isOwner} onClick={() => deleteProject(selected)}>
                    Löschen
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
                <h3>Unterprojekte</h3>
                <div className="card-grid">
                  {selected.children.map((p) => (
                    <ProjectTile key={p.id} p={p} onOpen={() => navigate(`/project/${p.id}`)} />
                  ))}
                </div>
              </section>
            )}

            <section className="col">
              <h3>Kabelbäume</h3>
              {harnesses.length === 0 ? (
                <div className="empty">
                  Noch keine Kabelbäume in diesem Projekt.
                  {canWrite && (
                    <div style={{ marginTop: 10 }}>
                      <button className="primary" onClick={createHarness}>
                        ＋ Kabelbaum anlegen
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
                        Geändert {fmtDate(h.updatedAt)}
                        {h.updatedByName ? ` von ${h.updatedByName}` : ''}
                      </div>
                      <div className="tile-actions" onClick={(e) => e.stopPropagation()}>
                        <button className="small" onClick={() => navigate(`/harness/${h.id}`)}>
                          Öffnen
                        </button>
                        <Dropdown label="⋯" buttonClass="small">
                          <MenuButton icon="✎" disabled={!canWrite} onClick={() => renameHarness(h)}>
                            Umbenennen
                          </MenuButton>
                          <MenuButton icon="⧉" disabled={!canWrite} onClick={() => duplicateHarness(h)}>
                            Duplizieren
                          </MenuButton>
                          <MenuButton icon="↦" disabled={!canWrite} onClick={() => setMoveFor({ harness: h })}>
                            In anderes Projekt verschieben …
                          </MenuButton>
                          <MenuButton icon="⇩" onClick={() => exportJson(h)}>
                            Als JSON exportieren
                          </MenuButton>
                          <MenuButton icon="🗑" danger disabled={!canWrite} onClick={() => deleteHarness(h)}>
                            Löschen
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
        {p.children.length} Unterprojekt{p.children.length === 1 ? '' : 'e'} · {p.harnessCount} Kabelb{p.harnessCount === 1 ? 'aum' : 'äume'}
      </div>
      {p.permission !== 'owner' && (
        <div className="small">
          <span className="badge accent">{PERM_LABEL[p.permission]}</span> <span className="muted">von {p.ownerName}</span>
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
    <Modal title={`„${project.name}“ freigeben`} onClose={onClose} footer={<button onClick={onClose}>Schließen</button>}>
      <p className="muted small">
        Eine Freigabe gilt für dieses Projekt inklusive aller Unterprojekte und Kabelbäume. „Lesen“ erlaubt Ansehen und Exportieren,
        „Bearbeiten“ zusätzlich Ändern und Anlegen.
      </p>
      {error && <div className="error-box">{error}</div>}
      <div className="row">
        <select className="grow" value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">Benutzer wählen …</option>
          {available.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName} ({u.username})
            </option>
          ))}
        </select>
        <select value={permission} onChange={(e) => setPermission(e.target.value)}>
          <option value="read">Lesen</option>
          <option value="write">Bearbeiten</option>
        </select>
        <button className="primary" disabled={!userId} onClick={add}>
          Hinzufügen
        </button>
      </div>
      {data && (
        <table className="table">
          <tbody>
            {data.shares.length === 0 && (
              <tr>
                <td className="muted">Noch keine Freigaben.</td>
              </tr>
            )}
            {data.shares.map((s) => (
              <tr key={s.userId}>
                <td>
                  {s.displayName} <span className="muted small">({s.username})</span>
                </td>
                <td style={{ width: 140 }}>
                  <select className="small" value={s.permission} onChange={(e) => change(s.userId, e.target.value)}>
                    <option value="read">Lesen</option>
                    <option value="write">Bearbeiten</option>
                  </select>
                </td>
                <td style={{ width: 40 }}>
                  <button className="ghost small danger" onClick={() => remove(s.userId)} title="Freigabe entfernen">
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
          <div className="muted small">Geerbt von übergeordneten Projekten:</div>
          {data.inherited.map((s, i) => (
            <div key={i} className="small">
              {s.displayName} – {PERM_LABEL[s.permission]} <span className="muted">(über „{s.projectName}“)</span>
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

  // Mögliche Ziele
  const options = useMemo(() => {
    const out = [];
    const walk = (nodes, depth) => {
      for (const n of nodes) {
        let ok;
        if (isHarness) ok = n.permission === 'owner' || n.permission === 'write';
        else {
          ok = n.permission === 'owner' && n.ownerId === target.ownerId;
          // nicht in sich selbst oder Nachfahren
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
      title={isHarness ? `„${target.harness.name}“ verschieben` : `„${target.name}“ verschieben`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Abbrechen</button>
          <button className="primary" disabled={!dest} onClick={submit}>
            Verschieben
          </button>
        </>
      }
    >
      {error && <div className="error-box">{error}</div>}
      <label className="field">
        Ziel
        <select value={dest} onChange={(e) => setDest(e.target.value)}>
          <option value="">Bitte wählen …</option>
          {!isHarness && <option value="root">(oberste Ebene)</option>}
          {options.map((o) => (
            <option key={o.id} value={o.id} disabled={!o.ok}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {projects.length === 0 && <div className="muted">Keine Projekte vorhanden.</div>}
    </Modal>
  );
}
