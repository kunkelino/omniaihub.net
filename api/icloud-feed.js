export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const target = process.env.APPLE_ICS_URL || "";
  if (!target) {
    res.status(500).json({ error: "APPLE_ICS_URL is not set on the server" });
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
    res.status(502).json({ error: "Could not load Apple calendar" });
  }
}
