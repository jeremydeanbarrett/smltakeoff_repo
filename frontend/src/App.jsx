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
          <strong>SML Takeoff</strong>
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
            <button className="btn danger" onClick={onLogout}>
              Logout
            </button>
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
    const { projects } = await api.listProjects();
    setProjects(projects || []);
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
          <div className="small">Projects are stored in SQLite.</div>
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
    const { project } = await api.getProject(projectId);
    const { files } = await api.listFiles(projectId);
    setProject(project);
    setFiles(files || []);
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

function RequireAuth({ children }) {
  const nav = useNavigate();

  useEffect(() => {
    // Real auth: if no token, go to login.
    if (!getToken()) nav("/login");
  }, [nav]);

  return children;
}

function HomeGate({ authed }) {
  // If authed, land on projects. Otherwise show login.
  return authed ? <Projects /> : <Login onAuthed={() => {}} />;
}

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());

  function logout() {
    clearToken();
    setAuthed(false);
    // HashRouter requires hash route for hard navigation:
    window.location.href = "/#/login";
  }

  // Keep auth state in sync if token changes
  useEffect(() => {
    const i = setInterval(() => setAuthed(!!getToken()), 400);
    return () => clearInterval(i);
  }, []);

  return (
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="container">
        <NavBar authed={authed} onLogout={logout} />
        <Routes>
          <Route path="/" element={authed ? <Projects /> : <Login onAuthed={setAuthed} />} />
          <Route path="/login" element={<Login onAuthed={setAuthed} />} />
          <Route path="/register" element={<Register onAuthed={setAuthed} />} />
          <Route path="/projects" element={<RequireAuth><Projects /></RequireAuth>} />
          <Route path="/libraries" element={<RequireAuth><LibrariesPage /></RequireAuth>} />
          <Route path="/projects/:id" element={<RequireAuth><ProjectView /></RequireAuth>} />
          <Route path="/takeoff/:projectId/:fileId/focus" element={<RequireAuth><TakeoffPage /></RequireAuth>} />
          <Route path="/takeoff/:projectId/:fileId" element={<RequireAuth><TakeoffPage /></RequireAuth>} />
          <Route path="*" element={<div className="card">Not found</div>} />
        </Routes>
      </div>
    </HashRouter>
  );
}
