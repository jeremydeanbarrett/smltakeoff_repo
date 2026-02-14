import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { ensureDefaultItems, withUserStore } from "../jsonStore.js";

const router = express.Router();
router.use(requireAuth);

router.get("/", (req, res) => {
  const userId = req.user.id;
  ensureDefaultItems(userId);
  const items = withUserStore(userId, (store) => store.items || []);
  res.json(items);
});

router.post("/", (req, res) => {
  const userId = req.user.id;
  const { category = "General", name, unit = "", rate = 0 } = req.body || {};
  if (!name || typeof name !== "string") return res.status(400).json({ error: "name required" });

  const item = {
    id: crypto.randomUUID(),
    category,
    name: name.trim(),
    unit,
    rate: Number(rate) || 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  withUserStore(userId, (store) => {
    if (!store.items) store.items = [];
    store.items.push(item);
  });

  res.status(201).json(item);
});

router.put("/:id", (req, res) => {
  const userId = req.user.id;
  const id = req.params.id;
  const { category, name, unit, rate } = req.body || {};

  let updated = null;
  withUserStore(userId, (store) => {
    if (!store.items) store.items = [];
    const idx = store.items.findIndex((x) => x.id === id);
    if (idx === -1) return;
    const cur = store.items[idx];
    const next = {
      ...cur,
      category: (category ?? cur.category),
      name: (name ?? cur.name),
      unit: (unit ?? cur.unit),
      rate: (rate ?? cur.rate),
      updatedAt: Date.now(),
    };
    store.items[idx] = next;
    updated = next;
  });

  if (!updated) return res.status(404).json({ error: "not found" });
  res.json(updated);
});

router.delete("/:id", (req, res) => {
  const userId = req.user.id;
  const id = req.params.id;

  let removed = false;
  withUserStore(userId, (store) => {
    if (!store.items) store.items = [];
    const before = store.items.length;
    store.items = store.items.filter((x) => x.id !== id);
    removed = store.items.length !== before;
  });

  if (!removed) return res.status(404).json({ error: "not found" });
  res.json({ ok: true });
});

export default router;
