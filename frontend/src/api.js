// Central API client for smltakeoff_repo
// JB requirement: NO localhost hardcoding. Always use Render backend.

const RAW_BASE =
  (import.meta?.env?.VITE_API_BASE &&
    String(import.meta.env.VITE_API_BASE).trim()) ||
  (import.meta?.env?.VITE_API_BASE_URL &&
    String(import.meta.env.VITE_API_BASE_URL).trim()) ||
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

// Some parts of your app import this specifically.
export function fileStreamUrl(path) {
  // Accepts "/api/..." or "api/..." or any backend path. Returns full URL.
  return toApiUrl(path);
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

export const api = {
  get: (path) => request(path),
  post: (path, body) =>
    request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    }),
  put: (path, body) =>
    request(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    }),
  del: (path) => request(path, { method: "DELETE" }),
};

export { request };
