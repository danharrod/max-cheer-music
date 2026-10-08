const {
  getStore,
  saveStore,
  makeToken,
  validToken,
  adminPassword,
  saveUpload,
  publicOrder,
} = require("../lib/store");
const {
  clientIp,
  loginGate,
  recordLoginFailure,
  clearLoginFailures,
  passwordsMatch,
  makeDownloadTicket,
} = require("../lib/auth");
const {
  adminOrder,
  setProductionStatus,
  setPaymentStatus,
  recordPayment,
  saveNotes,
  activity,
} = require("../lib/orders");

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

function inferKind(url, kind) {
  if (String(kind || "").toLowerCase() === "video") return "video";
  if (/\.(mp4|mov|webm|m4v|avi|mkv)(\?|$)/i.test(String(url || ""))) return "video";
  return "audio";
}

function adminPayload(store) {
  return {
    revision: Number(store.revision) || 0,
    settings: {
      paypalMe: store.settings?.paypalMe || "",
      venmo: store.settings?.venmo || "",
      email: store.settings?.email || "maxcheermusic@gmail.com",
    },
    products: store.products,
    orders: (store.orders || []).map(adminOrder).reverse(),
    clips: Array.isArray(store.clips) ? store.clips : [],
  };
}

function findOrder(store, orderId) {
  return (store.orders || []).find((o) => o.id === String(orderId || "").trim());
}

const CLIP_CONTENT_TYPES = [
  "audio/*",
  "video/*",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/aac",
  "audio/x-m4a",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
  "video/avi",
  "video/3gpp",
  "application/octet-stream",
];

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let body;
  try {
    body = await readBody(req);
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const action = body.action;

  if (action === "login") {
    const password = adminPassword();
    if (!password) return res.status(500).json({ error: "Set ADMIN_PASSWORD in Vercel env." });
    const ip = clientIp(req);
    const gate = loginGate(ip);
    if (!gate.ok) return res.status(429).json({ error: "Too many login attempts. Try again later." });
    if (!passwordsMatch(body.password, password)) {
      recordLoginFailure(ip);
      return res.status(401).json({ error: "Wrong password" });
    }
    clearLoginFailures(ip);
    return res.status(200).json({ token: makeToken() });
  }

  if (!validToken(body.token)) return res.status(401).json({ error: "Unauthorized" });

  try {
    if (action === "load") {
      const store = await getStore();
      return res.status(200).json(adminPayload(store));
    }

    if (action === "save") {
      if (!body.store || !Array.isArray(body.store.products)) {
        return res.status(400).json({ error: "Invalid store" });
      }
      const current = await getStore();
      if (body.revision != null && Number(body.revision) !== Number(current.revision || 0)) {
        return res.status(409).json({
          error: "This catalog was saved somewhere else. Reload and try again.",
          ...adminPayload(current),
        });
      }
      current.settings = {
        paypalMe: String(body.store.settings?.paypalMe || "").replace(/^@/, "").trim().slice(0, 80),
        venmo: String(body.store.settings?.venmo || "").replace(/^@/, "").trim().slice(0, 80),
        email: String(body.store.settings?.email || current.settings?.email || "maxcheermusic@gmail.com").trim(),
      };
      const allowedIds = new Set((current.products || []).map((p) => p.id));
      current.products = body.store.products
        .filter((p) => allowedIds.has(String(p.id || "").trim()))
        .map((p) => {
          const prev = (current.products || []).find((x) => x.id === String(p.id || "").trim());
          const price = Number(p.price);
          return {
            id: prev.id,
            name: String(p.name || prev.name || "").trim().slice(0, 80),
            title: String(p.title || p.name || prev.title || "").trim().slice(0, 80),
            price: Number.isFinite(price) && price >= 0 ? price : Number(prev.price) || 0,
            description: String(p.description || "").slice(0, 2000),
            sampleName: prev?.sampleName || "",
            sampleUrl: prev?.sampleUrl || "",
            sampleKind: prev?.sampleKind || "audio",
            samples: Array.isArray(prev?.samples) ? prev.samples : [],
            active: p.active !== false,
          };
        });
      const ok = await saveStore(current);
      if (!ok) return res.status(500).json({ error: "Could not save prices. Storage is not connected." });
      const saved = await getStore();
      return res.status(200).json(adminPayload(saved));
    }

    if (action === "upload") {
      if (!body.filename || !body.data) return res.status(400).json({ error: "Missing file" });
      const buffer = Buffer.from(body.data, "base64");
      if (buffer.length > 3.2 * 1024 * 1024) {
        return res.status(400).json({ error: "File is too large for this upload path. Use the sample uploader." });
      }
      const saved = await saveUpload(body.filename, buffer, body.kind || "samples");
      return res.status(200).json(saved);
    }

    if (action === "sample-token" || action === "clip-token") {
      const productId = String(body.productId || "").trim();
      const filename = String(body.filename || "sample.mp3");
      const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "-");
      const pathname =
        action === "sample-token" && productId
          ? `samples/${productId}/${Date.now()}-${safe}`
          : `clips/${Date.now()}-${safe}`;
      const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
      if (!blobToken) return res.status(500).json({ error: "Storage is not connected." });
      const { generateClientTokenFromReadWriteToken } = require("@vercel/blob/client");
      const clientToken = await generateClientTokenFromReadWriteToken({
        token: blobToken,
        pathname,
        addRandomSuffix: false,
        validUntil: Date.now() + 60 * 60 * 1000,
        allowedContentTypes: CLIP_CONTENT_TYPES,
        maximumSizeInBytes: 500 * 1024 * 1024,
      });
      return res.status(200).json({ clientToken, pathname });
    }

    if (action === "sample-save") {
      const productId = String(body.productId || "").trim();
      const url = String(body.url || "").trim();
      const hasName = Object.prototype.hasOwnProperty.call(body, "sampleName");
      if (!productId || (!url && !hasName)) return res.status(400).json({ error: "Missing sample" });
      const store = await getStore();
      const product = (store.products || []).find((p) => p.id === productId);
      if (!product) return res.status(404).json({ error: "Product not found" });
      if (!Array.isArray(product.samples)) product.samples = [];
      if (url) {
        const kind = inferKind(url, body.sampleKind);
        const name = hasName ? String(body.sampleName || "").trim() : String(product.sampleName || "").trim();
        product.samples.push({ id: `s-${Date.now()}`, name, url, kind, published: true });
        product.sampleUrl = url;
        product.sampleKind = kind;
        if (name) product.sampleName = name;
      } else if (hasName) {
        product.sampleName = String(body.sampleName || "").trim();
      }
      const ok = await saveStore(store);
      if (!ok) return res.status(500).json({ error: "Could not save sample." });
      return res.status(200).json(adminPayload(await getStore()));
    }

    if (action === "clip-add") {
      const url = String(body.url || "").trim();
      const name = String(body.name || "").trim().slice(0, 120);
      if (!url) return res.status(400).json({ error: "Missing clip" });
      const store = await getStore();
      if (!Array.isArray(store.clips)) store.clips = [];
      store.clips.push({
        id: `clip-${Date.now()}`,
        name,
        url,
        kind: inferKind(url, body.kind),
        published: body.published !== false,
        sort: store.clips.length,
        createdAt: Date.now(),
      });
      const ok = await saveStore(store);
      if (!ok) return res.status(500).json({ error: "Could not save sample." });
      return res.status(200).json(adminPayload(await getStore()));
    }

    if (action === "clip-update") {
      const clipId = String(body.clipId || body.id || "").trim();
      if (!clipId) return res.status(400).json({ error: "Missing clip" });
      const store = await getStore();
      const clips = store.clips || [];
      const index = clips.findIndex((c) => c.id === clipId);
      if (index < 0) return res.status(404).json({ error: "Sample not found" });
      if (Object.prototype.hasOwnProperty.call(body, "name")) {
        clips[index].name = String(body.name || "").trim().slice(0, 120);
      }
      if (Object.prototype.hasOwnProperty.call(body, "published")) {
        clips[index].published = body.published !== false;
      }
      if (body.dir === "up" && index > 0) {
        [clips[index - 1], clips[index]] = [clips[index], clips[index - 1]];
      }
      if (body.dir === "down" && index < clips.length - 1) {
        [clips[index + 1], clips[index]] = [clips[index], clips[index + 1]];
      }
      clips.forEach((c, i) => {
        c.sort = i;
      });
      store.clips = clips;
      const ok = await saveStore(store);
      if (!ok) return res.status(500).json({ error: "Could not update sample." });
      return res.status(200).json(adminPayload(await getStore()));
    }

    if (action === "clip-delete") {
      const clipId = String(body.clipId || body.id || "").trim();
      if (!clipId) return res.status(400).json({ error: "Missing clip" });
      const store = await getStore();
      if (!Array.isArray(store.clips)) store.clips = [];
      const removed = store.clips.find((c) => c.id === clipId || c.url === clipId);
      store.clips = store.clips.filter((c) => c.id !== clipId && c.url !== clipId);
      store.clips.forEach((c, i) => {
        c.sort = i;
      });
      if (removed?.url && process.env.BLOB_READ_WRITE_TOKEN && !process.env.MAX_TEST_STORE) {
        try {
          const { del } = require("@vercel/blob");
          await del(removed.url, { token: process.env.BLOB_READ_WRITE_TOKEN });
        } catch (err) {
          console.error("clip blob delete failed", err && err.message);
        }
      }
      const ok = await saveStore(store);
      if (!ok) return res.status(500).json({ error: "Could not remove sample." });
      return res.status(200).json(adminPayload(await getStore()));
    }

    if (action === "sample-delete") {
      const productId = String(body.productId || "").trim();
      const sampleId = String(body.sampleId || "").trim();
      if (!productId || !sampleId) return res.status(400).json({ error: "Missing sample" });
      const store = await getStore();
      const product = (store.products || []).find((p) => p.id === productId);
      if (!product) return res.status(404).json({ error: "Product not found" });
      const removed = (product.samples || []).find((s) => s.id === sampleId || s.url === sampleId);
      product.samples = (product.samples || []).filter((s) => s.id !== sampleId && s.url !== sampleId);
      if (removed?.url && process.env.BLOB_READ_WRITE_TOKEN && !process.env.MAX_TEST_STORE) {
        try {
          const { del } = require("@vercel/blob");
          await del(removed.url, { token: process.env.BLOB_READ_WRITE_TOKEN });
        } catch (err) {
          console.error("sample blob delete failed", err && err.message);
        }
      }
      const last = product.samples[product.samples.length - 1];
      product.sampleUrl = last ? last.url : "";
      product.sampleKind = last ? last.kind : "audio";
      if (last?.name) product.sampleName = last.name;
      else if (!last) product.sampleName = "";
      const ok = await saveStore(store, { mergeSamples: false });
      if (!ok) return res.status(500).json({ error: "Could not remove sample." });
      return res.status(200).json(adminPayload(await getStore()));
    }

    if (action === "attach") {
      const store = await getStore();
      const order = findOrder(store, body.orderId);
      if (!order) return res.status(404).json({ error: "Order not found" });
      if (!body.filename || !body.data) return res.status(400).json({ error: "Missing file" });
      const buffer = Buffer.from(body.data, "base64");
      const saved = await saveUpload(body.filename, buffer, "mixes");
      order.files = order.files || [];
      order.files.push({
        id: `file-${Date.now()}`,
        name: body.filename,
        url: saved.url,
        file: saved.file || saved.url,
      });
      setProductionStatus(order, "ready");
      const attached = await saveStore(store);
      if (!attached) return res.status(500).json({ error: "Could not save mix upload." });
      return res.status(200).json(adminPayload(await getStore()));
    }

    if (action === "status") {
      const store = await getStore();
      const order = findOrder(store, body.orderId);
      if (!order) return res.status(404).json({ error: "Order not found" });
      setProductionStatus(order, body.status);
      const ok = await saveStore(store);
      if (!ok) return res.status(500).json({ error: "Could not save status." });
      return res.status(200).json(adminPayload(await getStore()));
    }

    if (action === "order-payment") {
      const store = await getStore();
      const order = findOrder(store, body.orderId);
      if (!order) return res.status(404).json({ error: "Order not found" });
      const result = recordPayment(order, body);
      const ok = await saveStore(store);
      if (!ok) return res.status(500).json({ error: "Could not save payment." });
      return res.status(200).json({ ...adminPayload(await getStore()), duplicate: result.duplicate });
    }

    if (action === "order-payment-status") {
      const store = await getStore();
      const order = findOrder(store, body.orderId);
      if (!order) return res.status(404).json({ error: "Order not found" });
      setPaymentStatus(order, body.paymentStatus);
      const ok = await saveStore(store);
      if (!ok) return res.status(500).json({ error: "Could not save payment status." });
      return res.status(200).json(adminPayload(await getStore()));
    }

    if (action === "order-notes") {
      const store = await getStore();
      const order = findOrder(store, body.orderId);
      if (!order) return res.status(404).json({ error: "Order not found" });
      saveNotes(order, body.notes);
      const ok = await saveStore(store);
      if (!ok) return res.status(500).json({ error: "Could not save notes." });
      return res.status(200).json(adminPayload(await getStore()));
    }

    if (action === "download-ticket") {
      const store = await getStore();
      const order = findOrder(store, body.orderId);
      if (!order) return res.status(404).json({ error: "Order not found" });
      const fileId = String(body.fileId || "").trim();
      const file =
        (order.countSheet && order.countSheet.id === fileId && order.countSheet) ||
        (order.files || []).find((f) => f.id === fileId);
      if (!file) return res.status(404).json({ error: "File not found" });
      return res.status(200).json({ ticket: makeDownloadTicket({ orderId: order.id, fileId }) });
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (err) {
    const status = Number(err.status) || 500;
    if (status >= 500) console.error("admin action failed", action, err && err.message);
    return res.status(status).json({ error: err.message || "Request failed" });
  }
};
