const ORDER_EMAIL = "maxcheermusic@gmail.com";

function readBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      if (!raw.length) return resolve({});
      try {
        resolve(JSON.parse(raw.toString("utf8")));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

async function sendWithResend(payload, text) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.ORDER_FROM_EMAIL || "MAX Cheer Music <orders@maxcheermusic.com>",
      to: [ORDER_EMAIL],
      reply_to: payload.email,
      subject: `Website contact — ${payload.first || ""} ${payload.last || ""}`.trim(),
      text,
    }),
  });
  return res.ok;
}

async function sendWithFormSubmit(payload, text) {
  const res = await fetch(`https://formsubmit.co/ajax/${ORDER_EMAIL}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      _captcha: false,
      _subject: `Website contact — ${payload.first || ""} ${payload.last || ""}`.trim(),
      _replyto: payload.email,
      _template: "box",
      name: `${payload.first || ""} ${payload.last || ""}`.trim(),
      email: payload.email,
      message: text,
    }),
  });
  const data = await res.json().catch(() => ({}));
  const success = data.success === true || data.success === "true";
  if (!res.ok || !success) throw new Error(data.message || "FormSubmit failed");
  return true;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let payload;
  try {
    payload = await readBody(req);
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const email = String(payload.email || "").trim();
  const message = String(payload.message || "").trim();
  if (!email || !message) return res.status(400).json({ error: "Missing contact details" });

  const text = [
    "WEBSITE CONTACT",
    "",
    `Name: ${payload.first || ""} ${payload.last || ""}`.trim(),
    `Email: ${email}`,
    "",
    message,
  ].join("\n");

  let emailed = false;
  try {
    emailed = (await sendWithResend(payload, text)) || (await sendWithFormSubmit(payload, text));
  } catch (err) {
    console.error("contact email failed", err);
  }
  if (!emailed) return res.status(502).json({ error: "Could not send message" });
  return res.status(200).json({ ok: true, emailed: true });
};
