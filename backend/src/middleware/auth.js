import crypto from "crypto";
function base64urlEncode(buf) {
  return Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function base64urlDecode(str) {
  const s = String(str).replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  return Buffer.from(s + pad, "base64");
}

function signToken(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const h = base64urlEncode(JSON.stringify(header));
  const p = base64urlEncode(JSON.stringify(payload));
  const data = `${h}.${p}`;
  const sig = base64urlEncode(crypto.createHmac("sha256", secret).update(data).digest());
  return `${data}.${sig}`;
}

function verifyToken(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  const data = `${h}.${p}`;
  const expected = base64urlEncode(crypto.createHmac("sha256", secret).update(data).digest());
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try {
    const payload = JSON.parse(base64urlDecode(p).toString("utf8"));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function issueToken(user) {
  const secret = process.env.JWT_SECRET || "smltakeoff-dev-secret";
  const ttlMs = Number(process.env.JWT_TTL_MS || 1000 * 60 * 60 * 24 * 30); // 30 days
  const payload = {
    sub: String(user.id),
    email: user.email || "",
    name: user.name || "",
    exp: Date.now() + ttlMs,
  };
  return signToken(payload, secret);
}

export function requireAuth(req, res, next) {
  // If AUTH_DISABLED=1, behave like old "local" mode.
  if (String(process.env.AUTH_DISABLED || "") === "1") {
    req.user = { id: "local", email: "local@sml", name: "Local" };
    return next();
  }

  // Token sources (in order):
  // 1) Authorization: Bearer <token>
  // 2) ?token=<token> (needed for direct PDF stream/download URLs)
  // 3) Cookie: token=<token>
  const auth = req.headers.authorization || "";
  const m = String(auth).match(/^Bearer\s+(.+)$/i);
  let token = m ? m[1] : "";

  if (!token && req.query && typeof req.query.token === "string") {
    token = req.query.token;
  }

  if (!token && typeof req.headers.cookie === "string") {
    const parts = req.headers.cookie.split(";").map(s => s.trim());
    const found = parts.find(p => p.toLowerCase().startsWith("token="));
    if (found) token = found.substring("token=".length);
  }
  const secret = process.env.JWT_SECRET || "smltakeoff-dev-secret";
  const payload = verifyToken(token, secret);
  if (!payload?.sub) return res.status(401).json({ error: "Unauthorized" });

  const userId = String(payload.sub);

  req.user = { id: userId, email: payload.email || "", name: payload.name || "" };
  next();
}
