const {
  getStore,
  saveStore,
} = require("../lib/store");
const { upsertUser } = require("./portal");
const { buildOrder, findByIdempotency } = require("../lib/orders");
const ORDER_EMAIL = "maxcheermusic@gmail.com";

function skipMail() {
  return process.env.MAX_SKIP_EMAILS === "1" || process.env.MAX_TEST_STORE === "1";
}

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

function formatOrder(order) {
  const items = (order.items || [])
    .map((i) => `- ${i.title} x${i.qty} — $${Number(i.price * i.qty).toLocaleString("en-US")}`)
    .join("\n");
  return [
    "NEW MAX CHEER MUSIC ORDER",
    "",
    `Payment method: ${order.method || "not selected"}`,
    order.poNumber ? `PO number: ${order.poNumber}` : "",
    `Total: $${Number(order.total || 0).toLocaleString("en-US")}`,
    "",
    "ITEMS",
    items || "(none)",
    "",
    "CUSTOMER",
    `Gym or school: ${order.gym || ""}`,
    `Coach: ${order.coachFirst || ""} ${order.coachLast || ""}`,
    `Email: ${order.email || ""}`,
    `Desired completion date: ${order.completionDate || ""}`,
    `Team name: ${order.teamName || ""}`,
    `Team colors: ${order.teamColors || ""}`,
    "",
    "VOICEOVER IDEAS",
    order.voiceover || "",
    "",
    "Next step reminder: customer will enter 5 songs and upload a count sheet PDF in the portal.",
  ].join("\n");
}

async function sendWithFormSubmit(order) {
  const res = await fetch(`https://formsubmit.co/ajax/${ORDER_EMAIL}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      _captcha: false,
      _subject: `New mix order — ${order.gym || "MAX Cheer Music"} / ${order.teamName || ""}`.trim(),
      _replyto: order.email,
      _template: "box",
      _autoresponse: "Thanks for your MAX Cheer Music order. Log in to the Portal with this email and the password you chose to enter your 5 songs and upload your count sheet PDF.",
      name: `${order.coachFirst || ""} ${order.coachLast || ""}`.trim(),
      email: order.email,
      gym: order.gym,
      team: order.teamName,
      payment: order.method,
      total: order.total,
      message: formatOrder(order),
    }),
  });
  const data = await res.json().catch(() => ({}));
  const success = data.success === true || data.success === "true";
  if (!res.ok || !success) {
    console.error("FormSubmit response", res.status, data);
    throw new Error(data.message || `FormSubmit failed (${res.status})`);
  }
  return data;
}

async function sendWithResend(order) {
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
      reply_to: order.email,
      subject: `New mix order — ${order.gym || ""} / ${order.teamName || ""}`.trim(),
      text: formatOrder(order),
    }),
  });
  return res.ok;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let order;
  try {
    order = await readBody(req);
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  try {
    const store = await getStore();
    const existing = findByIdempotency(store.orders, order.idempotencyKey);
    if (existing) {
      return res.status(200).json({ ok: true, orderId: existing.id, emailed: false, duplicate: true });
    }
    const saved = buildOrder(store, order);
    upsertUser(store, order);
    store.orders = store.orders || [];
    store.orders.push(saved);
    const ok = await saveStore(store);
    if (!ok) return res.status(500).json({ error: "Could not save order." });

    let emailed = false;
    if (!skipMail()) {
      try {
        const resend = await sendWithResend(saved);
        if (resend) emailed = true;
        else {
          await sendWithFormSubmit(saved);
          emailed = true;
        }
      } catch (err) {
        console.error("order email failed");
      }
    }
    return res.status(200).json({ ok: true, orderId: saved.id, emailed });
  } catch (err) {
    const status = Number(err.status) || 502;
    if (status >= 500) console.error("order save failed");
    return res.status(status).json({ error: err.message || "Could not place order" });
  }
};

module.exports.formatOrder = formatOrder;
