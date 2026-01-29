import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";

import { requireAuth } from "./middleware/auth.js";
import { withUserStore, ensureDefaultProjects, ensureDefaultItems, ensureDefaultItemFolders } from "./jsonStore.js";

dotenv.config();

const app = express();
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

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------
const uploadsDir = path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const upload = multer({ dest: uploadsDir });

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
app.get("/api/health", (req, res) => res.json({ ok: true }));

// ---------------------------------------------------------------------------
// Auth (NO-AUTH local dev mode)
// ---------------------------------------------------------------------------
app.post("/api/auth/login", (req, res) => {
  res.json({ ok: true, token: "dev-noauth", user: { id: 1, name: "SML" } });
});
app.post("/api/auth/register", (req, res) => {
  res.json({ ok: true, token: "dev-noauth", user: { id: 1, name: "SML" } });
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

app.post("/api/projects", requireAuth, (req, res) => {
  const userId = req.user.id;
  ensureDefaultProjects(userId);
  const name = String(req.body?.name || "New Project").trim() || "New Project";
  const id = Date.now();
  const project = { id, name, createdAt: nowIso(), updatedAt: nowIso() };
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

app.post("/api/items", requireAuth, (req, res) => {
  const userId = req.user.id;
  ensureDefaultItems(userId);

  const body = req.body || {};
  const system_type = String(body.systemType ?? body.system_type ?? "").trim() || "General";
  const category = String(body.category ?? "").trim() || "General";
  const item_name = String(body.itemName ?? body.item_name ?? body.name ?? "").trim() || "New Item";
  const size = String(body.size ?? "").trim() || "";
  const folder_id = body.folderId ?? body.folder_id ?? null;

  const item = {
    id: Date.now(),
    system_type,
    category,
    item_name,
    size,
    folder_id,
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
  const data = body.data || {};

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

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`SML Takeoff backend (J35) running on http://localhost:${PORT}`);
});