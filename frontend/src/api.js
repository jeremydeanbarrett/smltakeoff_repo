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

export function toApiUrl(path) {
  if (!path) return API_BASE;
  if (typeof path !== "string") path = String(path);
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

async function request(path, opts = {}) {
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

// ---- Files ----
export function fileStreamUrl(fileId) {
  return toApiUrl(`/api/files/${fileId}/stream`);
}

export function fileDownloadUrl(fileId) {
  return toApiUrl(`/api/files/${fileId}/download`);
}

export async function uploadFile(projectId, file) {
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

// ---- API Object (App.jsx expects these) ----
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

  // Files
  listFiles: (projectId) => request(`/api/projects/${projectId}/files`),

  // ---- Libraries (STOP THE CRASH NOW) ----
  // Your frontend is calling api.listItemFolders(), but backend wiring may not be done yet.
  // For now we return an empty list so the app doesn't throw and break other pages.
  listItemFolders: async () => {
    return { folders: [] };
  },
};

export { request };
