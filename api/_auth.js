const crypto = require("crypto");

function secret() {
  return process.env.ADMIN_SESSION_SECRET || "";
}

function makeSession(username) {
  const payload = Buffer.from(JSON.stringify({
    u: username,
    exp: Date.now() + 8 * 60 * 60 * 1000
  })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
  return payload + "." + sig;
}

function validSession(req) {
  const header = req.headers.cookie || "";
  const match = header.match(/(?:^|;\s*)store_session=([^;]+)/);
  if (!match || !secret()) return false;
  const [payload, sig] = match[1].split(".");
  if (!payload || !sig) return false;
  const expected = crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    return data.exp > Date.now();
  } catch {
    return false;
  }
}

function requireAdmin(req, res) {
  if (!validSession(req)) {
    res.status(401).json({ error: "Not signed in." });
    return false;
  }
  return true;
}

module.exports = { makeSession, validSession, requireAdmin };
