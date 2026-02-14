import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "../db.js";

const router = express.Router();

function sign(user) {
  const secret = process.env.JWT_SECRET || "DEV_SECRET_CHANGE_ME";
  return jwt.sign({ userId: user.id, email: user.email }, secret, { expiresIn: "7d" });
}

function authRequired(req, res, next) {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const secret = process.env.JWT_SECRET || "DEV_SECRET_CHANGE_ME";
    const payload = jwt.verify(token, secret);
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

router.get("/me", authRequired, (req, res) => {
  const { userId } = req.user || {};
  const user = db.prepare("SELECT id, email, created_at FROM users WHERE id = ?").get(userId);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  return res.json({ user });
});

router.post("/register", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password || password.length < 6) return res.status(400).json({ error: "Email + password (min 6) required" });

  const hash = bcrypt.hashSync(password, 10);
  try {
    const stmt = db.prepare("INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)");
    const info = stmt.run(email.toLowerCase(), hash, Date.now());
    const token = sign({ id: info.lastInsertRowid, email: email.toLowerCase() });
    return res.json({ token });
  } catch (e) {
    if (String(e).includes("UNIQUE")) return res.status(400).json({ error: "Email already exists" });
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email + password required" });

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase());
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  return res.json({ token: sign(user) });
});

export default router;
