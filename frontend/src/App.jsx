import React, { useEffect, useState } from "react";
// HashRouter avoids 404s on refresh/deep links on static hosting (Render Static Site)
import { HashRouter, Routes, Route, Link, useNavigate, useParams } from "react-router-dom";
import {
  api,
  setToken,
  clearToken,
  getToken,
  uploadFile,
  fileStreamUrl,
  fileDownloadUrl,
  deleteFile,
} from "./api.js";
import TakeoffPage from "./takeoff/TakeoffPage.jsx";
import LibrariesPage from "./libraries/LibrariesPage.jsx";

function NavBar({ authed, onLogout }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row">
          <img src="/branding/sml_logo.png" alt="SML" style={{ width: 28, height: 28, objectFit: "contain", marginRight: 8 }} />
          <strong style={{ letterSpacing: 0.4 }}>SML Takeoff</strong>
          {authed && (
            <>
              <Link to="/projects" style={{ textDecoration: "none" }}>
                <button className="btn secondary">Projects</button>
              </Link>
              <Link to="/libraries" style={{ textDecoration: "none" }}>
                <button className="btn secondary">Libraries</button>
              </Link>
            </>
          )}
        </div>
        <div className="row">
          {authed ? (
            <>
              <Link to="/account" style={{ textDecoration: "none" }}>
                <button
                  className="btn secondary"
                  title="Account"
                  style={{ padding: "6px 10px", minWidth: 0, borderRadius: 999 }}
                >
                  {/* user icon */}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 12c2.761 0 5-2.239 5-5s-2.239-5-5-5-5 2.239-5 5 2.239 5 5 5Z" stroke="currentColor" strokeWidth="2"/>
                    <path d="M4 21c0-4.418 3.582-8 8-8s8 3.582 8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </button>
              </Link>
              <button className="btn danger" onClick={onLogout}>Logout</button>
            </>
            ) : (
            <>
              <Link to="/login" style={{ textDecoration: "none" }}>
                <button className="btn secondary">Login</button>
              </Link>
              <Link to="/register" style={{ textDecoration: "none" }}>
                <button className="btn">Register</button>
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Login({ onAuthed }) {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    setErr("");
    try {
      const { token } = await api.login(email, password);
      setToken(token);
      onAuthed(true);
      nav("/projects");
    } catch (ex) {
      setErr(ex.message || String(ex));
    }
  }

  return (
    <div className="card">
      <h2>Login</h2>
      {err && <div className="card" style={{ borderColor: "#c0392b" }}>{err}</div>}
      <form onSubmit={submit} className="row" style={{ flexDirection: "column", alignItems: "stretch" }}>
        <input className="input" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="input" placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button className="btn" type="submit">Login</button>
      </form>
    </div>
  );
}

function Register({ onAuthed }) {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    setErr("");
    try {
      const { token } = await api.register(email, password);
      setToken(token);
      onAuthed(true);
      nav("/projects");
    } catch (ex) {
      setErr(ex.message || String(ex));
    }
  }

  return (
    <div className="card">
      <h2>Register</h2>
      {err && <div className="card" style={{ borderColor: "#c0392b" }}>{err}</div>}
      <form onSubmit={submit} className="row" style={{ flexDirection: "column", alignItems: "stretch" }}>
        <input className="input" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="input" placeholder="Password (min 6 chars)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button className="btn" type="submit">Create account</button>
      </form>
    </div>
  );
}

function Projects() {
  const [projects, setProjects] = useState([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [err, setErr] = useState("");

  async function refresh() {
    const data = await api.listProjects();
    const projects = Array.isArray(data) ? data : (data?.projects || []);
    setProjects(projects);
  }

  useEffect(() => { refresh(); }, []);

  async function add() {
    setErr("");
    try {
      await api.createProject(name, description);
      setName("");
      setDescription("");
      refresh();
    } catch (ex) {
      setErr(ex.message || String(ex));
    }
  }

  async function del(id) {
    if (!confirm("Delete this project? This also deletes its files.")) return;
    await api.deleteProject(id);
    refresh();
  }

  return (
    <div className="grid">
      <div className="card">
        <h2>Create Project</h2>
        {err && <div className="card" style={{ borderColor: "#c0392b" }}>{err}</div>}
        <div className="row" style={{ flexDirection: "column", alignItems: "stretch" }}>
          <input className="input" placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input" placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
          <button className="btn" onClick={add} disabled={!name}>Add</button>
          <div className="small">Projects are stored locally (JSON store).</div>
        </div>
      </div>

      <div className="card">
        <h2>Projects</h2>
        <div className="row" style={{ flexDirection: "column", alignItems: "stretch" }}>
          {projects.map((p) => (
            <div key={p.id} className="card" style={{ padding: 12 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <div><strong>{p.name}</strong></div>
                  <div className="small">{p.description || ""}</div>
                </div>
                <div className="row">
                  <Link to={`/projects/${p.id}`} style={{ textDecoration: "none" }}>
                    <button className="btn">Open</button>
                  </Link>
                  <button className="btn danger" onClick={() => del(p.id)}>Delete</button>
                </div>
              </div>
            </div>
          ))}
          {projects.length === 0 && <div className="small">No projects yet.</div>}
        </div>
      </div>
    </div>
  );
}

function ProjectView() {
  const { id } = useParams();
  const projectId = Number(id);
  const [project, setProject] = useState(null);
  const [files, setFiles] = useState([]);
  const [selected, setSelected] = useState(null);
  const [err, setErr] = useState("");

  async function refresh() {
    const projectData = await api.getProject(projectId);
    const fileData = await api.listFiles(projectId);

    const project = projectData?.project ?? projectData;
    const files = Array.isArray(fileData) ? fileData : (fileData?.files || []);

    setProject(project);
    setFiles(files);
    if (files?.length && !selected) setSelected(files[0]);
  }

  useEffect(() => { refresh(); }, [projectId]);

  async function onUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr("");
    try {
      await uploadFile(projectId, file);
      e.target.value = "";
      setSelected(null);
      refresh();
    } catch (ex) {
      setErr(ex.message || String(ex));
    }
  }

  async function onDeleteFile(fid) {
    if (!confirm("Delete this file?")) return;
    await deleteFile(fid);
    setSelected(null);
    refresh();
  }

  function onDownloadFile(fid) {
    window.open(fileDownloadUrl(fid), "_blank", "noopener,noreferrer");
  }

  return (
    <div className="grid">
      <div className="card">
        <Link to="/projects" style={{ textDecoration: "none" }}>
          <button className="btn secondary">← Back</button>
        </Link>

        <h2 style={{ marginTop: 12 }}>{project?.name || "Project"}</h2>
        <div className="card" style={{ padding: 12, marginTop: 12 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <strong>Project Info</strong>
            <button className="btn secondary" onClick={async () => {
              if (!project) return;
              await api.updateProject(projectId, {
                name: project.name,
                clientName: project.clientName || "",
                clientAddress: project.clientAddress || "",
                clientPhone: project.clientPhone || "",
                clientEmail: project.clientEmail || "",
                clientNotes: project.clientNotes || "",
              });
              refresh();
            }}>
              Save
            </button>
          </div>

          <div className="row" style={{ flexDirection: "column", alignItems: "stretch", marginTop: 10 }}>
            <input className="input" placeholder="Client name" value={project?.clientName || ""} onChange={(e) => setProject({ ...project, clientName: e.target.value })} />
            <input className="input" placeholder="Client address" value={project?.clientAddress || ""} onChange={(e) => setProject({ ...project, clientAddress: e.target.value })} />
            <input className="input" placeholder="Client phone" value={project?.clientPhone || ""} onChange={(e) => setProject({ ...project, clientPhone: e.target.value })} />
            <input className="input" placeholder="Client email" value={project?.clientEmail || ""} onChange={(e) => setProject({ ...project, clientEmail: e.target.value })} />
            <input className="input" placeholder="Notes" value={project?.clientNotes || ""} onChange={(e) => setProject({ ...project, clientNotes: e.target.value })} />
          </div>
        </div>

        {err && <div className="card" style={{ borderColor: "#c0392b" }}>{err}</div>}

        <div className="card" style={{ padding: 12 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>Files</strong>
            <input type="file" className="input" onChange={onUpload} />
          </div>

          <div style={{ marginTop: 12 }}>
            {files.map((f) => (
              <div
                key={f.id}
                className="row"
                style={{
                  justifyContent: "space-between",
                  padding: "8px 0",
                  borderBottom: "1px solid #2a3242",
                }}
              >
                <div style={{ cursor: "pointer" }} onClick={() => setSelected(f)}>
                  <div><strong>{f.original_name}</strong></div>
                  <div className="small">
                    {(f.size_bytes / 1024 / 1024).toFixed(2)} MB • {f.mime_type}
                  </div>
                </div>

                <div className="row">
                  {f.mime_type === "application/pdf" && (
                    <Link to={`/takeoff/${projectId}/${f.id}`} style={{ textDecoration: "none" }}>
                      <button className="btn">Takeoff</button>
                    </Link>
                  )}
                  <button className="btn secondary" onClick={() => onDownloadFile(f.id)}>
                    Download
                  </button>
                  <button className="btn danger" onClick={() => onDeleteFile(f.id)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
            {files.length === 0 && <div className="small">No files uploaded yet.</div>}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Preview</h2>
        {!selected && <div className="small">Select a file to preview.</div>}
        {selected && selected.mime_type === "application/pdf" && (
          <iframe
            title="pdf"
            src={fileStreamUrl(selected.id)}
            style={{ width: "100%", height: "75vh", border: "none", borderRadius: 12 }}
          />
        )}
        {selected && selected.mime_type !== "application/pdf" && (
          <div className="small">Preview only supports PDFs in Phase 1/2. Use Download to open.</div>
        )}
      </div>
    </div>
  );
}


function AccountPage({ onLogout }) {
  const [me, setMe] = useState(null);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");

  useEffect(() => {
    (async () => {
      setErr("");
      try {
        const data = await api.me();
        setMe(data?.user || data);
      } catch (ex) {
        setErr(ex.message || String(ex));
      }
    })();
  }, []);

  async function changePassword(e) {
    e.preventDefault();
    setErr("");
    setOk("");
    if (!oldPw || !newPw) {
      setErr("Enter old + new password.");
      return;
    }
    if (newPw.length < 6) {
      setErr("New password must be at least 6 characters.");
      return;
    }
    if (newPw !== newPw2) {
      setErr("New passwords do not match.");
      return;
    }
    try {
      await api.changePassword(oldPw, newPw);
      setOldPw("");
      setNewPw("");
      setNewPw2("");
      setOk("Password updated.");
    } catch (ex) {
      setErr(ex.message || String(ex));
    }
  }

  async function downloadBackup() {
    setErr("");
    setOk("");
    try {
      const blob = await api.downloadBackup();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `smltakeoff_backup_${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setOk("Backup downloaded.");
    } catch (ex) {
      setErr(ex.message || String(ex));
    }
  }

  async function restoreBackupFromFile(file) {
    setErr("");
    setOk("");
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      // server accepts {store: ...} or raw store
      await api.restoreBackup(json.store ? { store: json.store } : { store: json });
      setOk("Backup restored. Refreshing…");
      setTimeout(() => window.location.reload(), 300);
    } catch (ex) {
      setErr(ex.message || String(ex));
    }
  }


  return (
    <div className="grid">
      <div className="card">
        <h2>Account</h2>
        {err && <div className="card" style={{ borderColor: "#c0392b" }}>{err}</div>}
        {ok && <div className="card" style={{ borderColor: "#2ecc71" }}>{ok}</div>}

        <div className="row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
          <div className="small"><strong>Email:</strong> {me?.email || "(unknown)"}</div>
          <div className="small"><strong>Name:</strong> {me?.name || ""}</div>
          <div className="small" style={{ opacity: 0.8 }}>
            Email change will be added later. Password change works now.
          </div>
          <button className="btn danger" onClick={onLogout} style={{ marginTop: 8 }}>Logout</button>
        </div>
      </div>

      <div className="card">
        <h2>Backup</h2>
        <div className="small" style={{ opacity: 0.85, marginBottom: 8 }}>
          Download/restore your projects + library + takeoff data (PDF uploads are not included).
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="btn" onClick={downloadBackup} type="button">Download Backup</button>
          <label className="btn secondary" style={{ cursor: "pointer" }}>
            Restore Backup
            <input
              type="file"
              accept="application/json"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files && e.target.files[0];
                if (!f) return;
                restoreBackupFromFile(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </div>

      <div className="card">
        <h2>Change Password</h2>
        <form onSubmit={changePassword} className="row" style={{ flexDirection: "column", alignItems: "stretch" }}>
          <input className="input" placeholder="Old password" type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
          <input className="input" placeholder="New password" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          <input className="input" placeholder="Confirm new password" type="password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} />
          <button className="btn" type="submit">Update password</button>
        </form>
      </div>
    </div>
  );
}


function RequireAuth({ children, authed, authChecked }) {
  const nav = useNavigate();

  useEffect(() => {
    if (!authChecked) return;
    if (!authed) nav("/login");
  }, [nav, authed, authChecked]);

  if (!authChecked) return <div className="card">Loading…</div>;
  return children;
}

function HomeGate({ authed }) {
  // If authed, land on projects. Otherwise show login.
  return authed ? <Projects /> : <Login onAuthed={() => {}} />;
}

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  function logout() {
    clearToken();
    setAuthed(false);
    setAuthChecked(true);
    // HashRouter requires hash route for hard navigation:
    window.location.href = "/#/login";
  }

  // Validate existing token on load (prevents showing Projects/Libraries with stale tokens)
  useEffect(() => {
    (async () => {
      const t = getToken();
      if (!t) { setAuthed(false);
    setAuthChecked(true); setAuthChecked(true); return; }
      try {
        await api.me();
        setAuthed(true);
      } catch {
        clearToken();
        setAuthed(false);
    setAuthChecked(true);
      } finally {
        setAuthChecked(true);
      }
    })();
  }, []);


  return (
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="container">
        <NavBar authed={authed} onLogout={logout} />
        <Routes>
          <Route path="/" element={!authChecked ? <div className="card">Loading…</div> : (authed ? <Projects /> : <Login onAuthed={setAuthed} />)} />
          <Route path="/login" element={<Login onAuthed={setAuthed} />} />
          <Route path="/register" element={<Register onAuthed={setAuthed} />} />
          <Route path="/projects" element={<RequireAuth authed={authed} authChecked={authChecked}><Projects /></RequireAuth>} />
          <Route path="/libraries" element={<RequireAuth authed={authed} authChecked={authChecked}><LibrariesPage /></RequireAuth>} />
          <Route path="/account" element={<RequireAuth authed={authed} authChecked={authChecked}><AccountPage onLogout={logout} /></RequireAuth>} />
          <Route path="/projects/:id" element={<RequireAuth authed={authed} authChecked={authChecked}><ProjectView /></RequireAuth>} />
          <Route path="/takeoff/:projectId/:fileId/focus" element={<RequireAuth authed={authed} authChecked={authChecked}><TakeoffPage /></RequireAuth>} />
          <Route path="/takeoff/:projectId/:fileId" element={<RequireAuth authed={authed} authChecked={authChecked}><TakeoffPage /></RequireAuth>} />
          <Route path="*" element={<div className="card">Not found</div>} />
        </Routes>
      </div>
    </HashRouter>
  );
}
