const crypto = require("crypto");
const {
  getStore,
  saveStore,
  hashPassword,
  customerToken,
  publicUser,
  publicOrder,
  validCustomer,
  saveUpload,
} = require("../lib/store");

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

function upsertUser(store, order) {
  const email = String(order.email || "").toLowerCase().trim();
  if (!email || !order.password) return null;
  let user = (store.users || []).find((u) => u.email === email);
  const salt = user?.salt || crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(order.password, salt);
  if (!user) {
    user = { email, salt, passwordHash };
    store.users.push(user);
  } else if (order.password) {
    user.salt = salt;
    user.passwordHash = passwordHash;
  }
  user.gym = order.gym || user.gym;
  user.coachFirst = order.coachFirst || user.coachFirst;
  user.coachLast = order.coachLast || user.coachLast;
  return user;
}

function ownOrder(store, user, orderId) {
  return (store.orders || []).find((o) => o.id === orderId && o.email === user.email);
}

function payload(user, store) {
  const orders = (store.orders || []).filter((o) => o.email === user.email).map(publicOrder).reverse();
  return { user: publicUser(user), orders };
}

async function notifyPortal(order, subject, extra) {
  const message = [
    subject,
    "",
    `Order: ${order.id}`,
    `Team: ${order.teamName || ""}`,
    `Gym: ${order.gym || ""}`,
    `Coach: ${order.coachFirst || ""} ${order.coachLast || ""}`,
    `Email: ${order.email || ""}`,
    "",
    extra,
  ].join("\n");
  try {
    const key = process.env.RESEND_API_KEY;
    if (key) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.ORDER_FROM_EMAIL || "MAX Cheer Music <orders@maxcheermusic.com>",
          to: [ORDER_EMAIL],
          reply_to: order.email,
          subject,
          text: message,
        }),
      });
      return;
    }
    await fetch(`https://formsubmit.co/ajax/${ORDER_EMAIL}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        _subject: subject,
        _replyto: order.email,
        name: `${order.coachFirst || ""} ${order.coachLast || ""}`.trim(),
        email: order.email,
        message,
      }),
    });
  } catch {}
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let body;
  try {
    body = await readBody(req);
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const store = await getStore();

  if (body.action === "login") {
    const email = String(body.email || "").toLowerCase().trim();
    const user = (store.users || []).find((u) => u.email === email);
    if (!user) return res.status(401).json({ error: "No portal account for that email." });
    const hash = hashPassword(body.password || "", user.salt);
    if (hash !== user.passwordHash) return res.status(401).json({ error: "Wrong password." });
    return res.status(200).json({
      token: customerToken(user.email, user.passwordHash),
      ...payload(user, store),
    });
  }

  const user = validCustomer(store, body.email, body.token);
  if (!user) return res.status(401).json({ error: "Please log in." });

  if (body.action === "me") {
    return res.status(200).json(payload(user, store));
  }

  if (body.action === "songs") {
    const order = ownOrder(store, user, body.orderId);
    if (!order) return res.status(404).json({ error: "Order not found" });
    order.songs = [0, 1, 2, 3, 4].map((i) => String((body.songs || [])[i] || "").trim());
    await saveStore(store);
    const list = order.songs.map((s, i) => `${i + 1}. ${s || "(blank)"}`).join("\n");
    await notifyPortal(order, `Song list — ${order.teamName || order.gym || "order"}`, list);
    return res.status(200).json(payload(user, store));
  }

  if (body.action === "sheet") {
    const order = ownOrder(store, user, body.orderId);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (!body.filename || !body.data) return res.status(400).json({ error: "Missing file" });
    if (!/\.pdf$/i.test(body.filename)) return res.status(400).json({ error: "Upload a PDF count sheet." });
    const buffer = Buffer.from(body.data, "base64");
    if (buffer.length > 12 * 1024 * 1024) return res.status(400).json({ error: "File is too large." });
    const saved = await saveUpload(body.filename, buffer, "sheets");
    order.countSheet = {
      id: `sheet-${Date.now()}`,
      name: body.filename,
      url: saved.url,
      file: saved.file || saved.url,
      kind: "sheets",
    };
    await saveStore(store);
    await notifyPortal(
      order,
      `Count sheet uploaded — ${order.teamName || order.gym || "order"}`,
      `File: ${body.filename}`
    );
    return res.status(200).json(payload(user, store));
  }

  return res.status(400).json({ error: "Unknown action" });
};

module.exports.upsertUser = upsertUser;
