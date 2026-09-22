function paypalBase() {
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

function money(n) {
  var v = Number(n);
  if (!isFinite(v) || v < 0) v = 0;
  return v.toFixed(2);
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

    var amount = money(body.amount);
    if (Number(amount) <= 0) {
      res.status(400).json({ error: "Amount must be greater than 0" });
      return;
    }

    var name = String(body.name || "").trim() || "Snack Center guest";
    var token = await getAccessToken();

    var orderResp = await fetch(paypalBase() + "/v2/checkout/orders", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            description: "Holy Family Snack Center donation",
            custom_id: name.slice(0, 127),
            amount: {
              currency_code: "USD",
              value: amount
            }
          }
        ]
      })
    });

    var order = await orderResp.json();
    if (!orderResp.ok || !order.id) {
      res.status(orderResp.status || 500).json({
        error: "PayPal create order failed",
        details: order
      });
      return;
    }

    res.status(200).json({ id: order.id });
  } catch (err) {
    res.status(500).json({ error: err.message || "Create order failed" });
  }
};
