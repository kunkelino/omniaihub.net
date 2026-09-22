function paypalBase() {
  var env = (process.env.PAYPAL_ENV || "live").toLowerCase();
  return env === "sandbox"
    ? "https://api-m.sandbox.paypal.com"
    : "https://api-m.paypal.com";
}

async function getAccessToken() {
  var clientId = process.env.PAYPAL_CLIENT_ID || "";
  var secret = process.env.PAYPAL_CLIENT_SECRET || "";
  if (!clientId || !secret) {
    throw new Error("Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET");
  }

  var auth = Buffer.from(clientId + ":" + secret).toString("base64");
  var resp = await fetch(paypalBase() + "/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + auth,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  var data = await resp.json();
  if (!resp.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "PayPal token failed");
  }
  return data.access_token;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    var body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    body = body || {};

    var orderID = String(body.orderID || body.orderId || "").trim();
    if (!orderID) {
      res.status(400).json({ error: "Missing orderID" });
      return;
    }

    var token = await getAccessToken();
    var capResp = await fetch(
      paypalBase() + "/v2/checkout/orders/" + encodeURIComponent(orderID) + "/capture",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json"
        }
      }
    );

    var captured = await capResp.json();
    if (!capResp.ok) {
      res.status(capResp.status || 500).json({
        error: "PayPal capture failed",
        details: captured
      });
      return;
    }

    res.status(200).json(captured);
  } catch (err) {
    res.status(500).json({ error: err.message || "Capture failed" });
  }
};
