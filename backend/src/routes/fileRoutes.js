import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db } from "../db.js";
import { requireAuth, requireAuthQueryToken } from "../middleware/auth.js";

const router = express.Router();
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

router.use(requireAuth);

router.get("/project/:projectId", (req, res) => {
  const projectId = Number(req.params.projectId);
  const files = db.prepare("SELECT * FROM files WHERE project_id=? ORDER BY id DESC").all(projectId);
  res.json({ files });
});

router.post("/project/:projectId", upload.single("file"), (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!req.file) return res.status(400).json({ error: "File required" });
  const info = db.prepare(`
    INSERT INTO files (project_id, original_name, stored_name, mime_type, size_bytes, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(projectId, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size, Date.now());
  res.json({ id: info.lastInsertRowid });
});

router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const f = db.prepare("SELECT * FROM files WHERE id=?").get(id);
  if (f) {
    const fp = path.join(uploadsDir, f.stored_name);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    db.prepare("DELETE FROM files WHERE id=?").run(id);
  }
  res.json({ ok: true });
});

// stream for iframe preview: allow token query
router.get("/:id/stream", requireAuthQueryToken, (req, res) => {
  const id = Number(req.params.id);
  const f = db.prepare("SELECT * FROM files WHERE id=?").get(id);
  if (!f) return res.status(404).json({ error: "Not found" });
  const fp = path.join(uploadsDir, f.stored_name);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: "Missing file" });
  res.setHeader("Content-Type", f.mime_type);
  fs.createReadStream(fp).pipe(res);
});

router.get("/:id/download", requireAuthQueryToken, (req, res) => {
  const id = Number(req.params.id);
  const f = db.prepare("SELECT * FROM files WHERE id=?").get(id);
  if (!f) return res.status(404).json({ error: "Not found" });
  const fp = path.join(uploadsDir, f.stored_name);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: "Missing file" });
  res.download(fp, f.original_name);
});

export default router;
