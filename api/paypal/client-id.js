module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  var clientId = process.env.PAYPAL_CLIENT_ID || "";
  var env = process.env.PAYPAL_ENV || "live";

  if (!clientId) {
    res.status(500).json({ error: "PAYPAL_CLIENT_ID is not set on Vercel" });
    return;
  }

  res.status(200).json({
    clientId: clientId,
    env: env
  });
};

