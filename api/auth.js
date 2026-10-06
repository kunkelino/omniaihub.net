const { makeSession } = require("./_auth");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const username = String(req.body?.username || "");
  const password = String(req.body?.password || "");

  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD || !process.env.ADMIN_SESSION_SECRET) {
    return res.status(503).json({ error: "Admin login is not configured yet." });
  }

  if (username !== process.env.ADMIN_USERNAME || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Incorrect username or password." });
  }

  const token = makeSession(username);
  res.setHeader("Set-Cookie", "store_session=" + token + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800");
  return res.status(200).json({ ok: true });
};
