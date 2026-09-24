export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-lifehub-pin");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const pin = String((req.headers && (req.headers["x-lifehub-pin"] || req.headers["X-Lifehub-Pin"])) || "").replace(/\D/g, "");
  if (pin !== "435777") {
    res.status(401).json({ error: "Need LifeHub code" });
    return;
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    res.status(501).json({ error: "Cloud notebook is not connected yet" });
    return;
  }

  const pathname = "lifehub-sync.json";

  try {
    if (req.method === "GET") {
      const data = await readBlob(token, pathname);
      res.status(200).json(data || { empty: true, updatedAt: 0 });
      return;
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const payload = {
        tasks: Array.isArray(body.tasks) ? body.tasks : [],
        buy: Array.isArray(body.buy) ? body.buy : [],
        events: Array.isArray(body.events) ? body.events : [],
        notes: Array.isArray(body.notes) ? body.notes : [],
        updatedAt: Date.now()
      };
      await writeBlob(token, pathname, payload);
      res.status(200).json({ ok: true, updatedAt: payload.updatedAt });
      return;
    }

    res.status(405).json({ error: "Use GET or POST" });
  } catch (err) {
    res.status(500).json({ error: "Cloud notebook failed", detail: String(err && err.message || err) });
  }
}

async function readBlob(token, pathname) {
  const listed = await fetch("https://blob.vercel-storage.com?" + new URLSearchParams({ prefix: pathname, limit: "10" }), {
    headers: { Authorization: "Bearer " + token, "x-api-version": "7" }
  });
  if (!listed.ok) {
    if (listed.status === 404) return null;
    throw new Error("list " + listed.status);
  }
  const info = await listed.json();
  const blobs = info.blobs || info.files || [];
  const hit = blobs.find(function (b) { return (b.pathname || b.url || "").indexOf(pathname) !== -1; }) || blobs[0];
  if (!hit || !hit.url) return null;
  const got = await fetch(hit.url, {
    headers: { Authorization: "Bearer " + token, "x-api-version": "7" },
    cache: "no-store"
  });
  if (got.status === 404) return null;
  if (!got.ok) throw new Error("read " + got.status);
  return await got.json();
}

async function writeBlob(token, pathname, payload) {
  const r = await fetch("https://blob.vercel-storage.com/" + pathname + "?download=1", {
    method: "PUT",
    headers: {
      Authorization: "Bearer " + token,
      "x-api-version": "7",
      "x-content-type": "application/json",
      "x-allow-overwrite": "true"
    },
    body: JSON.stringify(payload)
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error("write " + r.status + " " + text.slice(0, 180));
  }
  return r.json().catch(function () { return {}; });
}
