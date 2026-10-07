const {
  getStore,
  saveStore,
  makeToken,
  validToken,
  adminPassword,
  saveUpload,
  publicOrder,
} = require("../lib/store");

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

module.exports = async (req, res) => {
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
    if (body.password !== password) return res.status(401).json({ error: "Wrong password" });
    return res.status(200).json({ token: makeToken() });
  }

  if (!validToken(body.token)) return res.status(401).json({ error: "Unauthorized" });

  if (action === "load") {
    const store = await getStore();
    return res.status(200).json({
      settings: store.settings,
      products: store.products,
      orders: (store.orders || []).map(publicOrder).reverse(),
    });
  }

  if (action === "save") {
    if (!body.store || !Array.isArray(body.store.products)) {
      return res.status(400).json({ error: "Invalid store" });
    }
    const current = await getStore();
    current.settings = {
      paypalMe: String(body.store.settings?.paypalMe || "").replace(/^@/, "").trim(),
      venmo: String(body.store.settings?.venmo || "").replace(/^@/, "").trim(),
      email: String(body.store.settings?.email || current.settings?.email || "maxcheermusic@gmail.com").trim(),
    };
    current.products = body.store.products.map((p) => ({
      id: String(p.id || "").trim() || `mix-${Date.now()}`,
      name: String(p.name || "").trim(),
      title: String(p.title || p.name || "").trim(),
      price: Number(p.price) || 0,
      description: String(p.description || ""),
      sampleName: String(p.sampleName || "").trim(),
      sampleUrl: String(p.sampleUrl || ""),
      active: p.active !== false,
    }));
    const ok = await saveStore(current);
    if (!ok) return res.status(500).json({ error: "Could not save prices. Storage is not connected." });
    const saved = await getStore();
    return res.status(200).json({
      settings: saved.settings,
      products: saved.products,
      orders: (saved.orders || []).map(publicOrder).reverse(),
    });
  }

  if (action === "upload") {
    if (!body.filename || !body.data) return res.status(400).json({ error: "Missing file" });
    const buffer = Buffer.from(body.data, "base64");
    const saved = await saveUpload(body.filename, buffer, body.kind || "samples");
    return res.status(200).json(saved);
  }

  if (action === "sample-token") {
    const productId = String(body.productId || "").trim();
    if (!productId) return res.status(400).json({ error: "Missing product" });
    const filename = String(body.filename || "sample.mp3");
    const safe = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
    const pathname = `samples/${productId}/${safe}`;
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    if (!blobToken) return res.status(500).json({ error: "Storage is not connected." });
    const { generateClientTokenFromReadWriteToken } = require("@vercel/blob/client");
    const clientToken = await generateClientTokenFromReadWriteToken({
      token: blobToken,
      pathname,
      addRandomSuffix: false,
      allowedContentTypes: [
        "audio/mpeg",
        "audio/mp3",
        "audio/wav",
        "audio/x-wav",
        "audio/wave",
        "audio/mp4",
        "audio/x-m4a",
        "audio/aac",
        "audio/ogg",
        "audio/webm",
        "application/octet-stream",
      ],
      maximumSizeInBytes: 80 * 1024 * 1024,
    });
    const storeId = blobToken.split("_")[3] || "";
    return res.status(200).json({ clientToken, pathname, storeId });
  }

  if (action === "sample-save") {
    const productId = String(body.productId || "").trim();
    const url = String(body.url || "").trim();
    const hasName = Object.prototype.hasOwnProperty.call(body, "sampleName");
    if (!productId || (!url && !hasName)) return res.status(400).json({ error: "Missing sample" });
    const store = await getStore();
    const product = (store.products || []).find((p) => p.id === productId);
    if (!product) return res.status(404).json({ error: "Product not found" });
    if (url) product.sampleUrl = url;
    if (hasName) product.sampleName = String(body.sampleName || "").trim();
    const ok = await saveStore(store);
    if (!ok) return res.status(500).json({ error: "Could not save sample." });
    const saved = await getStore();
    return res.status(200).json({
      settings: saved.settings,
      products: saved.products,
      orders: (saved.orders || []).map(publicOrder).reverse(),
    });
  }

  if (action === "attach") {
    const store = await getStore();
    const order = (store.orders || []).find((o) => o.id === body.orderId);
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
    order.status = "ready";
    const attached = await saveStore(store);
    if (!attached) return res.status(500).json({ error: "Could not save mix upload." });
    return res.status(200).json(publicOrder(order));
  }

  if (action === "status") {
    const store = await getStore();
    const order = (store.orders || []).find((o) => o.id === body.orderId);
    if (!order) return res.status(404).json({ error: "Order not found" });
    const allowed = ["received", "in-progress", "ready"];
    if (!allowed.includes(body.status)) return res.status(400).json({ error: "Invalid status" });
    order.status = body.status;
    const ok = await saveStore(store);
    if (!ok) return res.status(500).json({ error: "Could not save status." });
    return res.status(200).json(publicOrder(order));
  }

  return res.status(400).json({ error: "Unknown action" });
};
