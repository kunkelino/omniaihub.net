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

  // Vercel has already decoded query parameters. Decode only if the value
  // still appears URL-encoded, avoiding accidental double-decoding.
  let target = raw;
  if (!/^https?:\/\//i.test(target)) {
    try { target = decodeURIComponent(raw); } catch (e) {}
  }

  if (!/^https?:\/\//i.test(target)) {
    console.warn("Calendar feed rejected: invalid URL scheme");
    res.status(400).json({ error: "URL must start with http or https" });
    return;
  }

  try {
    const upstream = await fetch(target, {
      headers: { Accept: "text/calendar, text/plain, */*" },
      cache: "no-store"
    });
    const body = await upstream.text();
    const eventCount = (body.match(/BEGIN:VEVENT/gi) || []).length;
    const starts = Array.from(body.matchAll(/DTSTART(?:;[^:\r\n]*)?:([^\r\n]+)/gi))
      .slice(0, 12).map(match => match[1]);
    console.info("Calendar feed result", JSON.stringify({
      status: upstream.status,
      contentType: upstream.headers.get("content-type") || "",
      bytes: Buffer.byteLength(body, "utf8"),
      isCalendar: body.includes("BEGIN:VCALENDAR"),
      eventCount,
      starts
    }));
    res.status(upstream.ok ? 200 : upstream.status);
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(body);
  } catch (err) {
    console.error("Calendar feed fetch error", err && err.message ? err.message : "unknown");
    res.status(502).json({ error: "Could not load calendar feed" });
  }
}
