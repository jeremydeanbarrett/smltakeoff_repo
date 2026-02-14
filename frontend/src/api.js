// frontend/src/api.js
// One API client that works both locally and online.
// - Local default: http://localhost:10000
// - Online: set VITE_API_BASE to your backend URL (no trailing slash)

const RAW_BASE =
  (import.meta?.env?.VITE_API_BASE && String(import.meta.env.VITE_API_BASE).trim()) ||
  (import.meta?.env?.VITE_API_BASE_URL && String(import.meta.env.VITE_API_BASE_URL).trim()) ||
  "http://localhost:10000";

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

async function requestBlob(path, opts = {}) {
  const url = toApiUrl(path);
  const res = await fetch(url, {
    ...opts,
    cache: "no-store",
    headers: authHeaders(opts.headers || {}),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`API ${res.status} ${res.statusText}: ${txt}`.trim());
  }
  return res.blob();
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
  const p = typeof path === "string" ? path : String(path);
  if (p.startsWith("http://") || p.startsWith("https://")) return p;
  return `${API_BASE}${p.startsWith("/") ? "" : "/"}${p}`;
}

export async function request(path, opts = {}) {
  const url = toApiUrl(path);
  const res = await fetch(url, {
    ...opts,
    cache: "no-store",
    headers: authHeaders(opts.headers || {}),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`API ${res.status} ${res.statusText}: ${txt}`.trim());
  }

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}


export async function requestKeepalive(path, opts = {}) {
  const url = toApiUrl(path);
  const res = await fetch(url, {
    ...opts,
    keepalive: true,
    cache: "no-store",
    headers: authHeaders(opts.headers || {}),
  });

  // Best-effort: during unload we can't reliably read the response body.
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, status: res.status };
}


// ---- Files ----
export function fileStreamUrl(fileId) {
  const token = getToken();
  const q = token ? `?token=${encodeURIComponent(token)}` : "";
  return toApiUrl(`/api/files/${fileId}/stream${q}`);
}

export function fileDownloadUrl(fileId) {
  const token = getToken();
  const q = token ? `?token=${encodeURIComponent(token)}` : "";
  return toApiUrl(`/api/files/${fileId}/download${q}`);
}

export async function uploadFile(projectId, file) {
  // UI expects this route; backend supports it as an alias.
  const url = toApiUrl(`/api/projects/${projectId}/files`);
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: authHeaders({}),
    body: form,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`API ${res.status} ${res.statusText}: ${txt}`.trim());
  }

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}

export async function deleteFile(fileId) {
  return request(`/api/files/${fileId}`, { method: "DELETE" });
}

// ---- API Object (App.jsx + pages use these) ----
export const api = {
  health: () => request(`/api/health`),

  // Auth (local mode returns a dev token)
  login: (email, password) =>
    request(`/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),

  register: (email, password, name="") =>
    request(`/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name }),
    }),

  me: () => request(`/api/auth/me`),

  changePassword: (oldPassword, newPassword) =>
    request(`/api/auth/change-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldPassword, newPassword }),
    }),


  // Backup
  downloadBackup: () => requestBlob(`/api/backup/download`),
  restoreBackup: (storeObj) =>
    request(`/api/backup/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(storeObj),
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

	  updateProject: (projectId, payload) =>
	    request(`/api/projects/${projectId}`, {
	      method: "PUT",
	      headers: { "Content-Type": "application/json" },
	      body: JSON.stringify(payload ?? {}),
	    }),

  deleteProject: (projectId) => request(`/api/projects/${projectId}`, { method: "DELETE" }),

  // Files (alias expected by the UI)
  listFiles: (projectId) => request(`/api/projects/${projectId}/files`),

  // Libraries
  listItemFolders: () => request(`/api/items/folders`),

  createItemFolder: (name) =>
    request(`/api/items/folders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),

  deleteItemFolder: (folderId) => request(`/api/items/folders/${folderId}`, { method: "DELETE" }),

  updateItemFolder: (folderId, payload) =>
    request(`/api/items/folders/${folderId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    }),

  seedItems: (force=false) =>
    request(`/api/items/seed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: !!force }),
    }),

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

  // Takeoffs
  getTakeoff: (projectId, fileId) => request(`/api/takeoffs/project/${projectId}/file/${fileId}`),

  saveTakeoff: (projectId, fileId, data) =>
    request(`/api/takeoffs/project/${projectId}/file/${fileId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data ?? {}),
    }),
};
