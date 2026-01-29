import express from "express";
import { db } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);

/**
 * GET current "Main" takeoff for a project+file for the logged-in user
 */
router.get("/project/:projectId/file/:fileId", (req, res) => {
  try {
    const projectId = Number(req.params.projectId);
    const fileId = Number(req.params.fileId);
    const userId = req.user.userId;

    if (!Number.isFinite(projectId) || !Number.isFinite(fileId)) {
      return res.status(400).json({ error: "Invalid projectId or fileId" });
    }

    const row = db.prepare(
      `SELECT * FROM takeoffs
       WHERE project_id=? AND file_id=? AND user_id=? AND version_name='Main'`
    ).get(projectId, fileId, userId);

    if (!row) return res.json({ takeoff: null });

    return res.json({
      takeoff: {
        id: row.id,
        versionName: row.version_name,
        unitMode: row.unit_mode,
        scaleMmPerPx: row.scale_mm_per_px,
        data: JSON.parse(row.data_json || "{}"),
        updatedAt: row.updated_at,
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to load takeoff" });
  }
});

/**
 * UPSERT current "Main" takeoff
 */
router.put("/project/:projectId/file/:fileId", (req, res) => {
  try {
    const projectId = Number(req.params.projectId);
    const fileId = Number(req.params.fileId);
    const userId = req.user.userId;

    if (!Number.isFinite(projectId) || !Number.isFinite(fileId)) {
      return res.status(400).json({ error: "Invalid projectId or fileId" });
    }

    // Ensure project exists
    const project = db.prepare("SELECT id FROM projects WHERE id=?").get(projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    // Ensure file exists AND belongs to project
    const file = db.prepare("SELECT id, project_id FROM files WHERE id=?").get(fileId);
    if (!file) return res.status(404).json({ error: "File not found" });
    if (Number(file.project_id) !== projectId) {
      return res.status(400).json({ error: "File does not belong to project" });
    }

    const { unitMode, scaleMmPerPx, data } = req.body || {};
    const now = Date.now();

    const existing = db.prepare(
      `SELECT id FROM takeoffs
       WHERE project_id=? AND file_id=? AND user_id=? AND version_name='Main'`
    ).get(projectId, fileId, userId);

    if (!existing) {
      const info = db.prepare(
        `INSERT INTO takeoffs
         (project_id, file_id, user_id, version_name, unit_mode, scale_mm_per_px, data_json, created_at, updated_at)
         VALUES (?, ?, ?, 'Main', ?, ?, ?, ?, ?)`
      ).run(
        projectId,
        fileId,
        userId,
        unitMode || "imperial",
        Number(scaleMmPerPx || 1.0),
        JSON.stringify(data || {}),
        now,
        now
      );
      return res.json({ id: info.lastInsertRowid });
    }

    db.prepare(
      `UPDATE takeoffs
       SET unit_mode=?, scale_mm_per_px=?, data_json=?, updated_at=?
       WHERE id=?`
    ).run(
      unitMode || "imperial",
      Number(scaleMmPerPx || 1.0),
      JSON.stringify(data || {}),
      now,
      existing.id
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to save takeoff" });
  }
});

export default router;
