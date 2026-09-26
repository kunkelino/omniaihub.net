// Vercel Serverless Function
// Saves One From Now chats so every phone / laptop sees the same rooms.
// Needs two environment variables in Vercel:
//   JSONBIN_BIN_ID
//   JSONBIN_KEY

const BIN = process.env.JSONBIN_BIN_ID;
const KEY = process.env.JSONBIN_KEY;
const BIN_URL = BIN ? `https://api.jsonbin.io/v3/b/${BIN}` : null;

const SEED = {
  info: [
    { id: "seed-dtc", who: "Anonymous", text: "down town crossing area", at: "2026-09-19T00:00:00.000Z", reports: 0 },
    { id: "seed-sf", who: "Anonymous", text: "St Francis help full", at: "2026-09-19T00:00:00.000Z", reports: 0 }
  ],
  story: []
};

function headers() {
  return {
    "Content-Type": "application/json",
    "X-Master-Key": KEY,
    "X-Bin-Meta": "false"
  };
}

function merge(a, b) {
  const map = new Map();
  (a || []).concat(b || []).forEach((row) => {
    if (!row || row.id == null) return;
    const id = String(row.id);
    if (!map.has(id)) map.set(id, row);
  });
  return Array.from(map.values()).sort((x, y) => String(y.at || "").localeCompare(String(x.at || "")));
}

async function readStore() {
  if (!BIN_URL || !KEY) return { ...SEED, _warning: "JSONBin keys not set yet" };
  const r = await fetch(`${BIN_URL}/latest`, { headers: headers(), cache: "no-store" });
  if (!r.ok) return { ...SEED };
  const data = await r.json();
  const body = data.record || data;
  return {
    info: Array.isArray(body.info) ? body.info : SEED.info.slice(),
    story: Array.isArray(body.story) ? body.story : []
  };
}

async function writeStore(next) {
  if (!BIN_URL || !KEY) return next;
  await fetch(BIN_URL, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify(next)
  });
  return next;
}

function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.end(JSON.stringify(obj));
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return send(res, 204, {});

  try {
    if (req.method === "GET") {
      const store = await readStore();
      store.info = merge(SEED.info, store.info);
      return send(res, 200, store);
    }

    if (req.method === "POST") {
      const incoming = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const current = await readStore();
      const next = {
        info: merge(SEED.info, merge(current.info, incoming.info)),
        story: merge(current.story, incoming.story)
      };
      await writeStore(next);
      return send(res, 200, next);
    }

    return send(res, 405, { error: "Use GET or POST" });
  } catch (err) {
    return send(res, 500, { error: String(err && err.message ? err.message : err) });
  }
};
