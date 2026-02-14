import express from "express";
import { db } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import multer from "multer";
import path from "path";
import fs from "fs";

const uploadsDir = path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const safe = `${Date.now()}_${Math.random().toString(16).slice(2)}${path.extname(file.originalname)}`;
    cb(null, safe);
  }
});
const upload = multer({ storage });

const router = express.Router();
router.use(requireAuth);

router.get("/", (req, res) => {
  const projects = db.prepare("SELECT * FROM projects ORDER BY id DESC").all();
  res.json({ projects });
});

router.post("/", (req, res) => {
  const { name, description } = req.body || {};
  if (!name) return res.status(400).json({ error: "Project name required" });
  const info = db.prepare("INSERT INTO projects (name, description, created_at) VALUES (?, ?, ?)").run(name, description || "", Date.now());
  res.json({ id: info.lastInsertRowid });
});

router.get("/:id", (req, res) => {
  const id = Number(req.params.id);
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  if (!project) return res.status(404).json({ error: "Not found" });
  res.json({ project });
});

router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  res.json({ ok: true });
});


// COMPAT: project-scoped file routes expected by older frontend builds
router.get("/:id/files", (req, res) => {
  const projectId = Number(req.params.id);
  const files = db.prepare("SELECT * FROM files WHERE project_id=? ORDER BY id DESC").all(projectId);
  res.json({ files });
});

router.post("/:id/files", upload.single("file"), (req, res) => {
  const projectId = Number(req.params.id);
  if (!req.file) return res.status(400).json({ error: "File required" });
  const info = db.prepare(`
    INSERT INTO files (project_id, original_name, stored_name, mime_type, size_bytes, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(projectId, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size, Date.now());
  res.json({ id: info.lastInsertRowid });
});

export default router;