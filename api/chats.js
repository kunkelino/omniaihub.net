// One From Now shared community store.
// Uses the existing JSONBin environment variables already used by OFN.
//
// JSONBin env vars:
//   JSONBIN_BIN_ID
//   JSONBIN_KEY
//
// The store now also keeps resources, videos, moderation queue, and suggestions.
// Unknown fields are preserved so older/public chat clients cannot wipe admin data.

const BIN = process.env.JSONBIN_BIN_ID;
const KEY = process.env.JSONBIN_KEY;
const BIN_URL = BIN ? `https://api.jsonbin.io/v3/b/${BIN}` : null;

const SEED = {
  info: [
    { id: "seed-dtc", who: "Anonymous", text: "down town crossing area", at: "2026-09-19T00:00:00.000Z", reports: 0 },
    { id: "seed-sf", who: "Anonymous", text: "St Francis help full", at: "2026-09-19T00:00:00.000Z", reports: 0 }
  ],
  story: [],
  rooms: {},
  resources: [],
  videos: [],
  modQueue: [],
  suggestions: []
};

function headers() {
  return {
    "Content-Type": "application/json",
    "X-Master-Key": KEY,
    "X-Bin-Meta": "false"
  };
}

function mergeRows(a, b) {
  const map = new Map();
  (a || []).concat(b || []).forEach((row) => {
    if (!row || row.id == null) return;
    map.set(String(row.id), row);
  });
  return Array.from(map.values()).sort((x, y) => String(y.at || "").localeCompare(String(x.at || "")));
}

function normalize(body) {
  const src = body && typeof body === "object" ? body : {};
  return {
    ...src,
    info: Array.isArray(src.info) ? src.info : SEED.info.slice(),
    story: Array.isArray(src.story) ? src.story : [],
    rooms: src.rooms && typeof src.rooms === "object" && !Array.isArray(src.rooms) ? src.rooms : {},
    resources: Array.isArray(src.resources) ? src.resources : [],
    videos: Array.isArray(src.videos) ? src.videos : [],
    modQueue: Array.isArray(src.modQueue) ? src.modQueue : [],
    suggestions: Array.isArray(src.suggestions) ? src.suggestions : []
  };
}

async function readStore() {
  if (!BIN_URL || !KEY) return { ...SEED, _warning: "JSONBin keys not set yet" };
  const r = await fetch(`${BIN_URL}/latest`, { headers: headers(), cache: "no-store" });
  if (!r.ok) return { ...SEED };
  const data = await r.json();
  return normalize(data.record || data);
}

async function writeStore(next) {
  if (!BIN_URL || !KEY) return next;
  const r = await fetch(BIN_URL, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify(next)
  });
  if (!r.ok) throw new Error("JSONBin save failed");
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
    const current = await readStore();

    if (req.method === "GET") {
      const out = {
        info: mergeRows(SEED.info, current.info),
        story: current.story,
        rooms: current.rooms,
        resources: current.resources,
        videos: current.videos,
        modQueue: current.modQueue,
        suggestions: current.suggestions
      };
      return send(res, 200, out);
    }

    if (req.method === "POST") {
      const incoming = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const next = {
        ...current,
        info: mergeRows(SEED.info, mergeRows(current.info, incoming.info)),
        story: mergeRows(current.story, incoming.story),
        rooms: incoming.rooms && typeof incoming.rooms === "object" && !Array.isArray(incoming.rooms)
          ? incoming.rooms
          : current.rooms
      };
      await writeStore(next);
      return send(res, 200, {
        info: next.info,
        story: next.story,
        rooms: next.rooms,
        resources: next.resources,
        videos: next.videos,
        modQueue: next.modQueue,
        suggestions: next.suggestions
      });
    }

    return send(res, 405, { error: "Use GET or POST" });
  } catch (err) {
    return send(res, 500, { error: String(err && err.message ? err.message : err) });
  }
};
