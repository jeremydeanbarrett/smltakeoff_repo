// frontend/src/api.js
// JB requirement: NO localhost hardcoding. Always use Render backend.

const RAW_BASE =
  (import.meta?.env?.VITE_API_BASE && String(import.meta.env.VITE_API_BASE).trim()) ||
  (import.meta?.env?.VITE_API_BASE_URL && String(import.meta.env.VITE_API_BASE_URL).trim()) ||
  "https://smltakeoff-backend.onrender.com";

export const API_BASE = RAW_BASE.replace(/\/$/, "");

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

// Build a full URL using API_BASE, unless already absolute.
export function toApiUrl(path) {
  if (!path) return API_BASE;
  if (typeof path !== "string") path = String(path);
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

export async function request(path, opts = {}) {
  const url = toApiUrl(path);

  const res = await fetch(url, {
    ...opts,
    headers: authHeaders(opts.headers || {}),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`API ${res.status} ${res.statusText}: ${txt}`.trim());
  }

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res;
}

// ---- Files (backend canonical: /api/files/project/:projectId, but backend also supports legacy /api/projects/:id/files) ----
export function fileStreamUrl(fileId) {
  return toApiUrl(`/api/files/${fileId}/stream`);
}

export function fileDownloadUrl(fileId) {
  return toApiUrl(`/api/files/${fileId}/download`);
}

export async function uploadFile(projectId, file) {
  // Use the legacy alias expected by App.jsx; backend maps it to /api/files/project/:projectId
  const url = toApiUrl(`/api/projects/${projectId}/files`);
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders({}),
    body: form,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`API ${res.status} ${res.statusText}: ${txt}`.trim());
  }

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res;
}

export async function deleteFile(fileId) {
  return request(`/api/files/${fileId}`, { method: "DELETE" });
}

// ---- API Object (App.jsx + pages expect these) ----
export const api = {
  // Auth
  login: (email, password) =>
    request(`/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),

  register: (email, password) =>
    request(`/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),

  // Projects
  listProjects: () => request(`/api/projects`),

  createProject: (name, description) =>
    request(`/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    }),

  getProject: (projectId) => request(`/api/projects/${projectId}`),

  deleteProject: (projectId) => request(`/api/projects/${projectId}`, { method: "DELETE" }),

  // Files (legacy alias expected by the UI)
  listFiles: (projectId) => request(`/api/projects/${projectId}/files`),

  // -------------------- Libraries --------------------
  // Folders
  listItemFolders: () => request(`/api/items/folders`),

  createItemFolder: (name) =>
    request(`/api/items/folders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),

  deleteItemFolder: (folderId) => request(`/api/items/folders/${folderId}`, { method: "DELETE" }),

  // Items
  listItems: () => request(`/api/items`),

  createItem: (payload) =>
    request(`/api/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    }),

  updateItem: (itemId, payload) =>
    request(`/api/items/${itemId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    }),

  deleteItem: (itemId) => request(`/api/items/${itemId}`, { method: "DELETE" }),

  // -------------------- Takeoffs --------------------
  getTakeoff: (projectId, fileId) => request(`/api/takeoffs/project/${projectId}/file/${fileId}`),

  saveTakeoff: (projectId, fileId, data) =>
    request(`/api/takeoffs/project/${projectId}/file/${fileId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data ?? {}),
    }),
};

