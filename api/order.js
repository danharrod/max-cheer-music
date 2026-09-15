const {
  getStore,
  saveStore,
} = require("../lib/store");
const { upsertUser } = require("./portal");
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
      _subject: `New mix order — ${order.gym || "MAX Cheer Music"} / ${order.teamName || ""}`.trim(),
      _replyto: order.email,
      _template: "box",
      name: `${order.coachFirst || ""} ${order.coachLast || ""}`.trim(),
      email: order.email,
      message: formatOrder(order),
    }),
  });
  if (!res.ok) throw new Error("FormSubmit failed");
  return res.json().catch(() => ({}));
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

  if (!order.email || !order.gym) {
    return res.status(400).json({ error: "Missing order details" });
  }

  try {
    const store = await getStore();
    if (order.password) upsertUser(store, order);
    const saved = {
      id: `ord-${Date.now()}`,
      status: "received",
      method: order.method,
      total: order.total,
      items: order.items || [],
      gym: order.gym,
      coachFirst: order.coachFirst,
      coachLast: order.coachLast,
      email: String(order.email).toLowerCase().trim(),
      completionDate: order.completionDate,
      teamName: order.teamName,
      teamColors: order.teamColors,
      voiceover: order.voiceover,
      poNumber: String(order.poNumber || "").trim(),
      songs: [],
      countSheet: null,
      createdAt: order.createdAt || new Date().toISOString(),
      files: [],
    };
    store.orders = store.orders || [];
    store.orders.push(saved);
    await saveStore(store);

    const resend = await sendWithResend(order);
    if (!resend) await sendWithFormSubmit(order);
    return res.status(200).json({ ok: true, orderId: saved.id });
  } catch (err) {
    return res.status(502).json({ error: "Could not send order email" });
  }
};

module.exports.formatOrder = formatOrder;
