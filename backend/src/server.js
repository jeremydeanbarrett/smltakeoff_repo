import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";

import { requireAuth, issueToken } from "./middleware/auth.js";
import { withUserStore, ensureDefaultProjects, ensureDefaultItems, ensureDefaultItemFolders } from "./jsonStore.js";

dotenv.config();

const app = express();

// Disable etags + caching for API responses to prevent 304 empty-body issues
app.disable("etag");
app.use((req, res, next) => {
  if (req.path && req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
  }
  next();
});
app.get("/", (_req, res) => {
  res.status(200).send("SML Takeoff backend is running. Try /api/health");
});

const corsOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: function (origin, cb) {
    // allow server-to-server / curl / no-origin requests
    if (!origin) return cb(null, true);
    if (corsOrigins.length === 0) return cb(null, true);
    if (corsOrigins.includes(origin)) return cb(null, true);
    return cb(new Error("CORS blocked: " + origin));
  },
  credentials: true,
}));
app.use(express.json({ limit: "25mb" }));
// =========================
// USERS (file-based, local)
// =========================
const DATA_DIR = path.join(process.cwd(), "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

function ensureDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    console.error("Failed to ensure data dir:", e);
  }
}

function readUsers() {
  ensureDataDir();
  try {
    if (!fs.existsSync(USERS_FILE)) return [];
    const raw = fs.readFileSync(USERS_FILE, "utf-8");
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error("Failed to read users:", e);
    return [];
  }
}

function writeUsers(users) {
  ensureDataDir();
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
  } catch (e) {
    console.error("Failed to write users:", e);
  }
}

// ---------------------------------------------------------------------------
// Password hashing (NO extra deps)
// PBKDF2 SHA-256, per-user salt
// ---------------------------------------------------------------------------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  const computed = crypto.pbkdf2Sync(String(password), String(salt), 120000, 32, "sha256").toString("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(String(hash), "hex"));
  } catch {
    return computed === String(hash);
  }
}

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------
const baseDir = process.env.SML_DATA_DIR || process.env.DATA_DIR || process.cwd();
const uploadsDir = path.resolve(baseDir, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const upload = multer({ dest: uploadsDir });

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
app.get("/api/health", (req, res) => res.json({ ok: true }));

// ---------------------------------------------------------------------------
// Auth (NO-AUTH local dev mode)
// ---------------------------------------------------------------------------
app.post("/api/auth/register", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const name = String(req.body?.name || "").trim() || "User";
  const password = String(req.body?.password || "");
  if (!email || !password) return res.status(400).json({ error: "email and password required" });

  const users = readUsers();
  if (users.some((u) => String(u.email).toLowerCase() === email)) {
    return res.status(400).json({ error: "email already exists" });
  }

  const id = crypto.randomUUID();
  const { salt, hash } = hashPassword(password);
  const user = { id, email, name, salt, hash, createdAt: Date.now() };
  users.push(user);
  writeUsers(users);

  const token = issueToken(user);
  // Set cookie to support direct /stream and /download usage in the browser.
  res.setHeader("Set-Cookie", `token=${encodeURIComponent(token)}; Path=/; SameSite=Lax`);
  res.json({ ok: true, token, user: { id, email, name } });
});

app.post("/api/auth/login", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!email || !password) return res.status(400).json({ error: "email and password required" });

  const users = readUsers();
  let user = users.find((u) => String(u.email).toLowerCase() === email);

  // DEV QUALITY-OF-LIFE: if user doesn't exist yet, auto-create.
  // This prevents "stuck" situations where a fresh install can't login.
  if (!user) {
    const id = crypto.randomUUID();
    const { salt, hash } = hashPassword(password);
    user = { id, email, name: "User", salt, hash, createdAt: Date.now() };
    users.push(user);
    writeUsers(users);
  }

  if (!verifyPassword(password, user.salt, user.hash)) {
    return res.status(401).json({ error: "invalid credentials" });
  }

  const token = issueToken(user);
  res.setHeader("Set-Cookie", `token=${encodeURIComponent(token)}; Path=/; SameSite=Lax`);
  res.json({ ok: true, token, user: { id: user.id, email: user.email, name: user.name } });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  // NOTE: requireAuth already validated token; return minimal profile
  res.json({ ok: true, user: { id: req.user.id, email: req.user.email || "", name: req.user.name || "" } });
});

app.post("/api/auth/change-password", requireAuth, (req, res) => {
  const userId = String(req.user.id);
  const oldPassword = String(req.body?.oldPassword || "");
  const newPassword = String(req.body?.newPassword || "");
  if (!oldPassword || !newPassword) return res.status(400).json({ error: "oldPassword and newPassword required" });

  const users = readUsers();
  const idx = users.findIndex((u) => String(u.id) === userId);
  if (idx < 0) return res.status(404).json({ error: "user not found" });

  const user = users[idx];
  if (!verifyPassword(oldPassword, user.salt, user.hash)) {
    return res.status(401).json({ error: "invalid credentials" });
  }
  const { salt, hash } = hashPassword(newPassword);
  users[idx] = { ...user, salt, hash, updatedAt: Date.now() };
  writeUsers(users);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function nowIso() {
  return new Date().toISOString();
}
function asNum(x, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}
function ensureFilesArray(store) {
  if (!Array.isArray(store.files)) store.files = [];
}
function ensureTakeoffsArray(store) {
  if (!Array.isArray(store.takeoffs)) store.takeoffs = [];
}
function normalizeFileToSnake(f) {
  // Frontend expects: id, project_id, original_name, stored_name, mime_type, size_bytes, created_at
  return {
    id: asNum(f.id),
    project_id: asNum(f.project_id ?? f.projectId),
    original_name: f.original_name ?? f.originalName ?? f.name ?? "",
    stored_name: f.stored_name ?? f.storedName ?? "",
    mime_type: f.mime_type ?? f.mimeType ?? "application/octet-stream",
    size_bytes: asNum(f.size_bytes ?? f.sizeBytes, 0),
    created_at: f.created_at ?? f.createdAt ?? nowIso(),
  };
}
function pickStoredName(f) {
  return f.stored_name || f.storedName || "";
}

// ---------------------------------------------------------------------------
// Projects (JSON store)
// ---------------------------------------------------------------------------
app.get("/api/projects", requireAuth, (req, res) => {
  const userId = req.user.id;
  ensureDefaultProjects(userId);
  const projects = withUserStore(userId, (store) => store.projects || []);
  res.json(projects);
});

app.get("/api/projects/:id", requireAuth, (req, res) => {
  const userId = req.user.id;
  ensureDefaultProjects(userId);
  const id = asNum(req.params.id);
  const project = withUserStore(userId, (store) => (store.projects || []).find((p) => asNum(p.id) === id) || null);
  if (!project) return res.status(404).json({ error: "Project not found" });
  res.json({ project });
});

app.put("/api/projects/:id", requireAuth, (req, res) => {
  const userId = req.user.id;
  ensureDefaultProjects(userId);
  const id = asNum(req.params.id);

  const body = req.body || {};
  let updated = null;

  withUserStore(userId, (store) => {
    store.projects = store.projects || [];
    const idx = store.projects.findIndex((p) => asNum(p.id) === id);
    if (idx < 0) return;
    const cur = store.projects[idx];

    if (body.name !== undefined) cur.name = String(body.name).trim() || cur.name;

    if (body.clientName !== undefined) cur.clientName = String(body.clientName).trim();
    if (body.clientAddress !== undefined) cur.clientAddress = String(body.clientAddress).trim();
    if (body.clientPhone !== undefined) cur.clientPhone = String(body.clientPhone).trim();
    if (body.clientEmail !== undefined) cur.clientEmail = String(body.clientEmail).trim();
    if (body.clientNotes !== undefined) cur.clientNotes = String(body.clientNotes).trim();

    cur.updatedAt = nowIso();
    updated = cur;
  });

  if (!updated) return res.status(404).json({ error: "Project not found" });
  res.json({ ok: true, project: updated });
});


app.post("/api/projects", requireAuth, (req, res) => {
  const userId = req.user.id;
  ensureDefaultProjects(userId);
  const name = String(req.body?.name || "New Project").trim() || "New Project";
  const id = Date.now();
  const project = { id, name, clientName: "", clientAddress: "", clientPhone: "", clientEmail: "", clientNotes: "", createdAt: nowIso(), updatedAt: nowIso() };
  withUserStore(userId, (store) => {
    store.projects = store.projects || [];
    store.projects.unshift(project);
  });
  res.json({ ok: true, project });
});

app.delete("/api/projects/:id", requireAuth, (req, res) => {
  const userId = req.user.id;
  ensureDefaultProjects(userId);
  const id = asNum(req.params.id);
  let removed = false;
  withUserStore(userId, (store) => {
    store.projects = store.projects || [];
    const before = store.projects.length;
    store.projects = store.projects.filter((p) => asNum(p.id) !== id);
    removed = store.projects.length !== before;

    // also remove linked files + takeoffs
    ensureFilesArray(store);
    store.files = store.files.filter((f) => asNum(f.project_id ?? f.projectId) !== id);
    ensureTakeoffsArray(store);
    store.takeoffs = store.takeoffs.filter((t) => asNum(t.projectId) !== id);
  });

  if (!removed) return res.status(404).json({ error: "Project not found" });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Files (project alias routes)
// Frontend expects:
//   GET  /api/projects/:projectId/files
//   POST /api/projects/:projectId/files  (multipart form-data field "file")
// These are aliases to the canonical routes under /api/files/project/:projectId.
// ---------------------------------------------------------------------------
app.get("/api/projects/:projectId/files", requireAuth, (req, res) => {
  const userId = req.user.id;
  const projectId = asNum(req.params.projectId);
  const files = withUserStore(userId, (store) => {
    ensureFilesArray(store);
    const out = store.files
      .filter((f) => asNum(f.project_id ?? f.projectId) === projectId)
      .map((f) => {
        const sn = normalizeFileToSnake(f);
        if (!sn.size_bytes) {
          const stored = pickStoredName(f);
          const abs = stored ? path.join(uploadsDir, stored) : null;
          if (abs && fs.existsSync(abs)) {
            try { sn.size_bytes = fs.statSync(abs).size; } catch {}
          }
        }
        return sn;
      })
      .sort((a, b) => asNum(b.id) - asNum(a.id));
    return out;
  });
  res.json(files);
});

app.post("/api/projects/:projectId/files", requireAuth, upload.single("file"), (req, res) => {
  const userId = req.user.id;
  const projectId = asNum(req.params.projectId);
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const originalName = req.file.originalname || "upload.bin";
  const storedName = `${Date.now()}_${crypto.randomBytes(6).toString("hex")}${path.extname(originalName) || ""}`;
  const destPath = path.join(uploadsDir, storedName);

  fs.renameSync(req.file.path, destPath);

  const fileRec = {
    id: Date.now(),
    project_id: projectId,
    original_name: originalName,
    stored_name: storedName,
    mime_type: req.file.mimetype || "application/octet-stream",
    size_bytes: req.file.size || 0,
    created_at: nowIso(),
  };

  withUserStore(userId, (store) => {
    ensureFilesArray(store);
    store.files.unshift(fileRec);
  });

  res.json({ ok: true, file: fileRec });
});

// ---------------------------------------------------------------------------
// Files (canonical API)
// ---------------------------------------------------------------------------
app.get("/api/files/project/:projectId", requireAuth, (req, res) => {
  const userId = req.user.id;
  const projectId = asNum(req.params.projectId);
  const files = withUserStore(userId, (store) => {
    ensureFilesArray(store);
    const out = store.files
      .filter((f) => asNum(f.project_id ?? f.projectId) === projectId)
      .map((f) => {
        const sn = normalizeFileToSnake(f);
        // backfill size if missing
        if (!sn.size_bytes) {
          const stored = pickStoredName(f);
          const abs = stored ? path.join(uploadsDir, stored) : null;
          if (abs && fs.existsSync(abs)) {
            try { sn.size_bytes = fs.statSync(abs).size; } catch {}
          }
        }
        return sn;
      })
      .sort((a, b) => asNum(b.id) - asNum(a.id));
    return out;
  });
  res.json(files);
});

app.post("/api/files/project/:projectId", requireAuth, upload.single("file"), (req, res) => {
  const userId = req.user.id;
  const projectId = asNum(req.params.projectId);
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const originalName = req.file.originalname || "upload.bin";
  const storedName = `${Date.now()}_${crypto.randomBytes(6).toString("hex")}${path.extname(originalName) || ""}`;
  const destPath = path.join(uploadsDir, storedName);

  fs.renameSync(req.file.path, destPath);

  const fileRec = {
    id: Date.now(),
    project_id: projectId,
    original_name: originalName,
    stored_name: storedName,
    mime_type: req.file.mimetype || "application/octet-stream",
    size_bytes: req.file.size || 0,
    created_at: nowIso(),
  };

  withUserStore(userId, (store) => {
    ensureFilesArray(store);
    store.files.unshift(fileRec);
  });

  res.json({ ok: true, file: fileRec });
});

app.get("/api/files/:fileId/stream", requireAuth, (req, res) => {
  const userId = req.user.id;
  const fileId = asNum(req.params.fileId);

  const file = withUserStore(userId, (store) => {
    ensureFilesArray(store);
    const f = store.files.find((x) => asNum(x.id) === fileId) || null;
    return f ? normalizeFileToSnake(f) : null;
  });

  if (!file) return res.status(404).send("Not found");

  const absPath = path.join(uploadsDir, file.stored_name);
  if (!fs.existsSync(absPath)) return res.status(404).send("Not found");

  res.setHeader("Content-Type", file.mime_type);
  fs.createReadStream(absPath).pipe(res);
});

app.get("/api/files/:fileId/download", requireAuth, (req, res) => {
  const userId = req.user.id;
  const fileId = asNum(req.params.fileId);

  const file = withUserStore(userId, (store) => {
    ensureFilesArray(store);
    const f = store.files.find((x) => asNum(x.id) === fileId) || null;
    return f ? normalizeFileToSnake(f) : null;
  });

  if (!file) return res.status(404).send("Not found");

  const absPath = path.join(uploadsDir, file.stored_name);
  if (!fs.existsSync(absPath)) return res.status(404).send("Not found");

  res.download(absPath, file.original_name || "download.bin");
});

app.delete("/api/files/:fileId", requireAuth, (req, res) => {
  const userId = req.user.id;
  const fileId = asNum(req.params.fileId);

  let removed = false;
  let storedName = "";
  withUserStore(userId, (store) => {
    ensureFilesArray(store);
    const idx = store.files.findIndex((x) => asNum(x.id) === fileId);
    if (idx >= 0) {
      const f = store.files[idx];
      storedName = pickStoredName(f);
      store.files.splice(idx, 1);
      removed = true;
    }
    ensureTakeoffsArray(store);
    store.takeoffs = store.takeoffs.filter((t) => asNum(t.fileId) !== fileId);
  });

  if (!removed) return res.status(404).json({ error: "Not found" });
  if (storedName) {
    const abs = path.join(uploadsDir, storedName);
    if (fs.existsSync(abs)) { try { fs.unlinkSync(abs); } catch {} }
  }
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Items (library) - SML schema (system_type, category, item_name, size)
// Frontend expects:
//   GET  /api/items -> { items: [...] }
//   POST /api/items { systemType, category, itemName, size }
//   PUT  /api/items/:id { systemType, category, itemName, size }
// ---------------------------------------------------------------------------
app.get("/api/items", requireAuth, (req, res) => {
  const userId = req.user.id;
  ensureDefaultItems(userId);
  const items = withUserStore(userId, (store) => store.items || []);
  res.json({ items });
});

app.post("/api/items/seed", requireAuth, (req, res) => {
  const userId = req.user.id;
  const force = Boolean(req.body?.force);
  const did = withUserStore(userId, (store) => {
    store.items = store.items || [];
    store.itemFolders = store.itemFolders || [];
    if (!force && store.items.length > 0) return false;
    // wipe + reseed
    store.items = [];
    ensureDefaultItemFolders(userId); // ensures folders exist
    // Re-run seed now that items are empty
    ensureDefaultItems(userId);
    return true;
  });
  res.json({ ok: true, seeded: did });
});


app.post("/api/items", requireAuth, (req, res) => {
  const userId = req.user.id;
  ensureDefaultItems(userId);

  const body = req.body || {};
  const system_type = String(body.systemType ?? body.system_type ?? "").trim() || "General";
  const category = String(body.category ?? "").trim() || "General";
  const item_name = String(body.itemName ?? body.item_name ?? body.name ?? "").trim() || "New Item";
  const size = String(body.size ?? "").trim() || "";
  const unit = String(body.unit ?? "").trim() || "ea";
  const folder_id = body.folderId ?? body.folder_id ?? null;

  const item = {
    id: Date.now(),
    system_type,
    category,
    item_name,
    size,
    unit,
    folder_id,
    cost_per_unit: asNum(body.costPerUnit ?? body.cost_per_unit ?? body.rate ?? 0, 0),
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  withUserStore(userId, (store) => {
    store.items = store.items || [];
    store.items.unshift(item);
  });

  res.json({ ok: true, item });
});

app.put("/api/items/:id", requireAuth, (req, res) => {
  const userId = req.user.id;
  ensureDefaultItems(userId);
  const id = asNum(req.params.id);

  let updated = null;
  withUserStore(userId, (store) => {
    store.items = store.items || [];
    const idx = store.items.findIndex((x) => asNum(x.id) === id);
    if (idx < 0) return;
    const cur = store.items[idx];

    const body = req.body || {};
    if (body.systemType !== undefined || body.system_type !== undefined) {
      cur.system_type = String(body.systemType ?? body.system_type).trim() || cur.system_type;
    }
    if (body.category !== undefined) cur.category = String(body.category).trim() || cur.category;
    if (body.itemName !== undefined || body.item_name !== undefined || body.name !== undefined) {
      cur.item_name = String(body.itemName ?? body.item_name ?? body.name).trim() || cur.item_name;
    }
    if (body.size !== undefined) cur.size = String(body.size).trim();
    if (body.unit !== undefined) cur.unit = String(body.unit).trim() || cur.unit || "ea";

    if (body.costPerUnit !== undefined || body.cost_per_unit !== undefined || body.rate !== undefined) {
      cur.cost_per_unit = asNum(body.costPerUnit ?? body.cost_per_unit ?? body.rate, cur.cost_per_unit ?? 0);
    }

    cur.updated_at = nowIso();
    updated = cur;
  });

  if (!updated) return res.status(404).json({ error: "not found" });
  res.json({ ok: true, item: updated });
});

app.delete("/api/items/:id", requireAuth, (req, res) => {
  const userId = req.user.id;
  ensureDefaultItems(userId);
  const id = asNum(req.params.id);

  let removed = false;
  withUserStore(userId, (store) => {
    store.items = store.items || [];
    const before = store.items.length;
    store.items = store.items.filter((x) => asNum(x.id) !== id);
    removed = store.items.length !== before;
  });

  if (!removed) return res.status(404).json({ error: "not found" });
  res.json({ ok: true });
});


// ---------------------------------------------------------------------------
// Item folders (Company Library)
// Frontend expects:
//   GET  /api/items/folders -> { folders: [...] }
//   POST /api/items/folders { name, parentId? }
// ---------------------------------------------------------------------------
app.get("/api/items/folders", requireAuth, (req, res) => {
  const userId = req.user.id;
  ensureDefaultItemFolders(userId);

  const store = withUserStore(userId, (s) => s);
  res.json({ folders: store.itemFolders || [] });
});

app.post("/api/items/folders", requireAuth, (req, res) => {
  const userId = req.user.id;
  const { name, parentId } = req.body || {};
  if (!name || String(name).trim() === "") return res.status(400).json({ error: "name required" });

  ensureDefaultItemFolders(userId);

  let folder = null;
  withUserStore(userId, (store) => {
    store.itemFolders = store.itemFolders || [];
    const id = store.itemFolders.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;
    folder = { id, name: String(name), parentId: parentId ?? null };
    store.itemFolders.push(folder);
  });

  res.json({ folder });
});

app.put("/api/items/folders/:id", requireAuth, (req, res) => {
  const userId = req.user.id;
  ensureDefaultItemFolders(userId);
  const id = asNum(req.params.id);
  const name = req.body?.name;
  const parentId = req.body?.parentId;

  let updated = null;
  withUserStore(userId, (store) => {
    store.itemFolders = store.itemFolders || [];
    const idx = store.itemFolders.findIndex((f) => asNum(f.id) === id);
    if (idx < 0) return;
    const cur = store.itemFolders[idx];
    if (name !== undefined) cur.name = String(name).trim() || cur.name;
    if (parentId !== undefined) cur.parentId = parentId ?? null;
    updated = cur;
  });

  if (!updated) return res.status(404).json({ error: "not found" });
  res.json({ ok: true, folder: updated });
});

app.delete("/api/items/folders/:id", requireAuth, (req, res) => {
  const userId = req.user.id;
  ensureDefaultItemFolders(userId);
  const id = asNum(req.params.id);

  let removed = false;
  withUserStore(userId, (store) => {
    store.itemFolders = store.itemFolders || [];
    const before = store.itemFolders.length;
    store.itemFolders = store.itemFolders.filter((f) => asNum(f.id) !== id);
    removed = store.itemFolders.length !== before;

    // any items in that folder become unassigned
    store.items = store.items || [];
    for (const it of store.items) {
      if (asNum(it.folder_id) === id) it.folder_id = null;
    }
  });

  if (!removed) return res.status(404).json({ error: "not found" });
  res.json({ ok: true });
});



// ---------------------------------------------------------------------------
// Backup (per-user JSON store)
// ---------------------------------------------------------------------------
// Download a JSON backup of this user's projects + library + takeoffs metadata.
// Note: PDF uploads are NOT included (those stay in /uploads). This is by design for now.
app.get("/api/backup/download", requireAuth, (req, res) => {
  const userId = req.user?.id;
  const payload = withUserStore(userId, (store) => {
    return {
      backupVersion: 1,
      exportedAt: new Date().toISOString(),
      user: { id: userId },
      store,
    };
  });

  const fname = `smltakeoff_backup_user_${userId}_${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
  return res.status(200).send(JSON.stringify(payload, null, 2));
});

app.post("/api/backup/restore", requireAuth, (req, res) => {
  const userId = req.user?.id;
  const body = req.body || {};
  const incoming = body.store || body;

  if (!incoming || typeof incoming !== "object") {
    return res.status(400).json({ error: "Invalid backup payload." });
  }

  withUserStore(userId, (store) => {
    // Hard replace keys (but keep object reference so withUserStore can write it)
    for (const k of Object.keys(store)) delete store[k];

    // Copy whitelisted top-level keys if present; otherwise copy everything.
    const src = incoming.store && typeof incoming.store === "object" ? incoming.store : incoming;
    for (const [k, v] of Object.entries(src)) store[k] = v;

    // Minimal normalization to prevent crashes
    if (!Array.isArray(store.projects)) store.projects = [];
    if (!Array.isArray(store.files)) store.files = [];
    if (!Array.isArray(store.takeoffs)) store.takeoffs = [];
    if (!Array.isArray(store.items)) store.items = [];
    if (!Array.isArray(store.itemFolders)) store.itemFolders = [];
  });

  return res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Takeoffs (strokes + scale per project+file) - JSON store
// Frontend calls:
//   GET /api/takeoffs/project/:projectId/file/:fileId
//   PUT /api/takeoffs/project/:projectId/file/:fileId   { scaleMmPerPx, data }
// ---------------------------------------------------------------------------
app.get("/api/takeoffs/project/:projectId/file/:fileId", requireAuth, (req, res) => {
  const userId = req.user.id;
  const projectId = asNum(req.params.projectId);
  const fileId = asNum(req.params.fileId);

  const takeoff = withUserStore(userId, (store) => {
    ensureTakeoffsArray(store);
    return store.takeoffs.find((t) => asNum(t.projectId) === projectId && asNum(t.fileId) === fileId) || null;
  });

  res.json({ takeoff });
});

app.put("/api/takeoffs/project/:projectId/file/:fileId", requireAuth, (req, res) => {
  const userId = req.user.id;
  const projectId = asNum(req.params.projectId);
  const fileId = asNum(req.params.fileId);

  const body = req.body || {};
  const scaleMmPerPx = body.scaleMmPerPx === undefined ? 1.0 : asNum(body.scaleMmPerPx, 1.0);
  // Accept either { data: {...} } OR raw takeoff object {...}
  const data = (body && typeof body === 'object')
    ? ((body.data && typeof body.data === 'object') ? body.data : body)
    : {};

  let out = null;
  withUserStore(userId, (store) => {
    ensureTakeoffsArray(store);
    const idx = store.takeoffs.findIndex((t) => asNum(t.projectId) === projectId && asNum(t.fileId) === fileId);
    const rec = {
      projectId,
      fileId,
      scaleMmPerPx,
      data,
      updatedAt: nowIso(),
      createdAt: idx >= 0 ? store.takeoffs[idx].createdAt : nowIso(),
    };
    if (idx >= 0) store.takeoffs[idx] = rec;
    else store.takeoffs.unshift(rec);
    out = rec;
  });

  res.json({ ok: true, takeoff: out });
});

/**
 * Serve built frontend (Render deploy)
 * Build step copies frontend/dist -> backend/public
 */
const PUBLIC_DIR = path.join(process.cwd(), "public");
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR, {
    etag: false,
    maxAge: 0,
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "no-store");
    },
  }));

  // SPA fallback (do not catch /api/*)
  app.get(/^\/(?!api\/).*/, (req, res) => {
    const indexHtml = path.join(PUBLIC_DIR, "index.html");
    if (fs.existsSync(indexHtml)) return res.sendFile(indexHtml);
    return res.status(404).send("index.html not found");
  });
}

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`SML Takeoff backend (J35) running on port ${PORT}`);
});