// Download counter for the DataDojo download page (Vercel serverless function, free tier).
//   GET  /api/downloads  -> { count }
//   POST /api/downloads  -> counts one download, at most once per visitor per day -> { count }
// Storage: Upstash Redis (Vercel Storage integration). Visitor IPs are only kept as a salted hash, for 24h.
const crypto = require("crypto");

const KEY = "datadojo:downloads";

async function redis(command) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("counter not configured");
  const r = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(command) });
  if (!r.ok) throw new Error(`redis ${r.status}`);
  return (await r.json()).result;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");            // the GitHub Pages copy reads it too
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    if (req.method === "POST") {
      const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
      const salt = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
      const visitor = crypto.createHash("sha256").update(salt + ip).digest("hex").slice(0, 32);
      const first = await redis(["SET", `${KEY}:seen:${visitor}`, "1", "EX", "86400", "NX"]);  // "OK" only the first time today
      const count = first === "OK" ? await redis(["INCR", KEY]) : Number(await redis(["GET", KEY])) || 0;
      return res.status(200).json({ count: Number(count) });
    }
    return res.status(200).json({ count: Number(await redis(["GET", KEY])) || 0 });
  } catch (e) {
    return res.status(503).json({ error: String(e.message || e) });
  }
};
