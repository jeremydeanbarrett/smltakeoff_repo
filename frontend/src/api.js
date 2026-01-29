// Central API client for SML Takeoff (local-first)
// Local backend default: http://localhost:10000
// Optional: set VITE_API_BASE (no trailing slash) for hosted backend later.

export const API_BASE =
  (import.meta?.env?.VITE_API_BASE && String(import.meta.env.VITE_API_BASE).replace(/\/$/, "")) ||
  "http://localhost:10000";

const TOKEN_KEY = "token";

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

function authHeaders(extra = {}) {
  const token = getToken();
  return {
    ...extra,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request(path, opts = {}) {
  const url = path.startsWith("http")
    ? path
    : `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
  const res = await fetch(url, { ...opts, headers: authHeaders(opts.headers || {}) });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`API ${res.status} ${res.statusText}: ${txt}`.trim());
  }

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}

// ---- Files (named exports used by UI) ----
export async function uploadFile(projectId, file) {
  const fd = new FormData();
  fd.append("file", file);
  return request(`/api/files/project/${projectId}`, { method: "POST", body: fd });
}

export function fileStreamUrl(fileId) {
  return `${API_BASE}/api/files/${fileId}/stream`;
}

export function fileDownloadUrl(fileId) {
  return `${API_BASE}/api/files/${fileId}/download`;
}

export async function deleteFile(fileId) {
  return request(`/api/files/${fileId}`, { method: "DELETE" });
}

// ---- Core API ----
export const api = {
  health: () => request("/api/health"),

  // Auth
  login: (email, password) =>
    request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),
  register: (email, password) =>
    request("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),

  // Projects
  // Backend returns a raw array; UI expects { projects: [...] }
  listProjects: () => request("/api/projects").then((projects) => ({ projects })),
  createProject: (name, description) =>
    request("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    }),
  deleteProject: (projectId) => request(`/api/projects/${projectId}`, { method: "DELETE" }),
  // Backend returns raw project object; UI expects { project: {...} }
  getProject: (projectId) => request(`/api/projects/${projectId}`).then((project) => ({ project })),

  // Files (project)
  // Backend returns raw array; UI expects { files: [...] }
  listFiles: (projectId) => request(`/api/files/project/${projectId}`).then((files) => ({ files })),


// Takeoffs (file-scoped)
// Backend stores takeoff data per (projectId, fileId)
getTakeoff: (projectId, fileId) =>
  request(`/api/takeoffs/project/${projectId}/file/${fileId}`).then((out) => out),
saveTakeoff: (projectId, fileId, data) =>
  request(`/api/takeoffs/project/${projectId}/file/${fileId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data }),
  }),

  // Library
  listItemFolders: () => request("/api/item-folders"),
  createItemFolder: (name) =>
    request("/api/item-folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  deleteItemFolder: (folderId) => request(`/api/item-folders/${folderId}`, { method: "DELETE" }),

  listItems: () => request("/api/items"),
  createItem: (payload) =>
    request("/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  updateItem: (itemId, payload) =>
    request(`/api/items/${itemId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  deleteItem: (itemId) => request(`/api/items/${itemId}`, { method: "DELETE" }),

  // Files
  listProjectFiles: (projectId) => request(`/api/files/project/${projectId}`),
  uploadFile: (projectId, file) => uploadFile(projectId, file),
  deleteFile: (fileId) => deleteFile(fileId),
};
