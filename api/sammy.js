export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = process.env.OPENAI_API_KEY || process.env.OPEN_AI_KEY || process.env.OPENAI_KEY;
  if (!key) {
    return res.status(500).json({
      error: "Missing OPENAI_API_KEY",
      reply: "Sammy is not connected yet. In Vercel add OPENAI_API_KEY or OPEN_AI_KEY, then Redeploy."
    });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const text = String((body && body.text) || "").trim();
  if (!text) return res.status(400).json({ error: "No text", reply: "I did not hear anything." });

  const today = body.today || "";
  const snapshot = {
    shopping: (body.shopping || []).slice(0, 40),
    tasks: (body.tasks || []).slice(0, 40),
    events: (body.events || []).slice(0, 40)
  };

  const system = [
    "You are Sammy, Jonathan's helpful LifeHub assistant.",
    "Speak briefly, like a person. Today is " + today + ".",
    "You may answer questions AND change LifeHub lists.",
    "You cannot change website HTML or code.",
    "Return ONLY JSON: {\"reply\":\"...\",\"actions\":[...]}",
    "Allowed actions:",
    "{\"type\":\"add_buy\",\"item\":\"milk\"}",
    "{\"type\":\"check_buy\",\"item\":\"milk\"}",
    "{\"type\":\"delete_buy\",\"item\":\"milk\"}",
    "{\"type\":\"add_task\",\"title\":\"call Nick\",\"due\":\"YYYY-MM-DD\"}",
    "{\"type\":\"check_task\",\"title\":\"call Nick\"}",
    "{\"type\":\"delete_task\",\"title\":\"call Nick\"}",
    "{\"type\":\"add_event\",\"title\":\"dentist\",\"date\":\"YYYY-MM-DD\",\"time\":\"11:15\"}",
    "{\"type\":\"add_note\",\"title\":\"idea\",\"text\":\"...\"}",
    "Use today's date when the user says today. Use empty actions if it is only a question.",
    "Current LifeHub data: " + JSON.stringify(snapshot)
  ].join(" ");

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: text }
        ]
      })
    });
    const data = await r.json();
    if (!r.ok) {
      return res.status(500).json({
        error: (data && data.error && data.error.message) || "OpenAI error",
        reply: "ChatGPT is not answering right now."
      });
    }
    let parsed = {};
    try {
      parsed = JSON.parse(data.choices[0].message.content || "{}");
    } catch (e) {
      parsed = { reply: data.choices[0].message.content || "Done.", actions: [] };
    }
    return res.status(200).json({
      reply: String(parsed.reply || "Okay."),
      actions: Array.isArray(parsed.actions) ? parsed.actions : []
    });
  } catch (err) {
    return res.status(500).json({ error: String(err), reply: "Could not reach ChatGPT." });
  }
}
