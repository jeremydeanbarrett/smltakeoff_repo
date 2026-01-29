/**
 * NO-COMPILE LOCAL MODE
 * We do NOT require JWT/login for local testing.
 * Every request is treated as a single local user.
 */
export function requireAuth(req, res, next) {
  req.user = { id: "local" };
  next();
}
