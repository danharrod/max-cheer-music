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
  if (!email) return null;
  let user = (store.users || []).find((u) => u.email === email);
  if (!user) {
    if (!order.password) return null;
    const salt = crypto.randomBytes(16).toString("hex");
    user = { email, salt, passwordHash: hashPassword(order.password, salt) };
    store.users.push(user);
  }
  user.gym = order.gym || user.gym;
  user.coachFirst = order.coachFirst || user.coachFirst;
  user.coachLast = order.coachLast || user.coachLast;
  return user;
}

function skipMail() {
  return process.env.MAX_SKIP_EMAILS === "1" || process.env.MAX_TEST_STORE === "1";
}

async function sendResetEmail(to, link) {
  const text = [
    "Reset your MAX Cheer Music portal password:",
    link,
    "",
    "This link expires in 1 hour. If you did not ask for this, ignore the email.",
  ].join("\n");
  const key = process.env.RESEND_API_KEY;
  if (key) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.ORDER_FROM_EMAIL || "MAX Cheer Music <orders@maxcheermusic.com>",
        to: [to],
        subject: "Reset your portal password",
        text,
      }),
    });
    if (!res.ok) throw new Error("reset email failed");
    return;
  }
  await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(to)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      _subject: "Reset your MAX Cheer Music portal password",
      message: text,
    }),
  });
}

function hashResetToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

const RESET_MESSAGE =
  "If that email has a portal account, we sent a reset link. New customers create access at checkout.";

function ownOrder(store, user, orderId) {
  return (store.orders || []).find((o) => o.id === orderId && o.email === user.email);
}

function payload(user, store) {
  const orders = (store.orders || []).filter((o) => o.email === user.email).map(publicOrder).reverse();
  return { user: publicUser(user), orders };
}

async function notifyPortal(order, subject, extra) {
  if (skipMail()) return;
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

  if (body.action === "request-reset") {
    const email = String(body.email || "").toLowerCase().trim();
    const generic = { ok: true, message: RESET_MESSAGE };
    const user = (store.users || []).find((u) => u.email === email);
    if (!user) return res.status(200).json(generic);
    const raw = crypto.randomBytes(32).toString("hex");
    user.resetTokenHash = hashResetToken(raw);
    user.resetTokenExp = Date.now() + 60 * 60 * 1000;
    await saveStore(store);
    const origin = String(req.headers.origin || "https://maxcheermusic.com").replace(/\/$/, "");
    const link = `${origin}/portal.html?reset=${raw}`;
    if (!skipMail()) {
      try {
        await sendResetEmail(user.email, link);
      } catch {}
    }
    if (process.env.MAX_TEST_STORE === "1") generic.testResetToken = raw;
    return res.status(200).json(generic);
  }

  if (body.action === "reset-password") {
    const token = String(body.resetToken || body.token || "").trim();
    const password = String(body.password || "");
    if (!token || password.length < 6) {
      return res.status(400).json({ error: "Choose a new password with at least 6 characters." });
    }
    const hashed = hashResetToken(token);
    const user = (store.users || []).find(
      (u) => u.resetTokenHash && u.resetTokenHash === hashed && Number(u.resetTokenExp) > Date.now()
    );
    if (!user) return res.status(400).json({ error: "That reset link is invalid or expired." });
    const salt = crypto.randomBytes(16).toString("hex");
    user.salt = salt;
    user.passwordHash = hashPassword(password, salt);
    user.resetTokenHash = "";
    user.resetTokenExp = 0;
    await saveStore(store);
    return res.status(200).json({ ok: true, message: "Password updated. Log in with your new password." });
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
