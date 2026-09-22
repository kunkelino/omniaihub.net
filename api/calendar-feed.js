export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const raw = String((req.query && (req.query.url || req.query.u)) || "").trim();
  if (!raw) {
    res.status(400).json({ error: "Missing url" });
    return;
  }

  let target = raw;
  try {
    target = decodeURIComponent(raw);
  } catch (e) {}

  if (!/^https?:\/\//i.test(target)) {
    res.status(400).json({ error: "URL must start with http or https" });
    return;
  }

  try {
    const upstream = await fetch(target, {
      headers: { Accept: "text/calendar, text/plain, */*" },
      cache: "no-store"
    });
    const text = await upstream.text();
    res.status(upstream.ok ? 200 : upstream.status);
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(text);
  } catch (err) {
    res.status(502).json({ error: "Could not load calendar feed" });
  }
}
