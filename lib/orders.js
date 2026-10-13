const crypto = require("crypto");

const PRODUCTION_STATUSES = ["received", "in-progress", "review", "ready"];
const PAYMENT_STATUSES = ["unpaid", "pending-review", "paid", "school-po", "refunded"];
const PAY_METHODS = ["paypal", "venmo", "School PO"];

function nowIso() {
  return new Date().toISOString();
}

function activity(action, detail) {
  return { at: nowIso(), action: String(action), detail: String(detail || "").slice(0, 500) };
}

function pricedItems(products, clientItems) {
  const byId = new Map((products || []).map((p) => [String(p.id), p]));
  const items = [];
  for (const raw of clientItems || []) {
    const product = byId.get(String(raw?.id || "").trim());
    if (!product || product.active === false) continue;
    const price = Number(product.price);
    if (!Number.isFinite(price) || price < 0) continue;
    const qty = Math.max(1, Math.min(20, Math.floor(Number(raw.qty) || 1)));
    items.push({
      id: product.id,
      name: product.name,
      title: product.title || product.name,
      price,
      qty,
    });
  }
  return items;
}

function orderTotal(items) {
  return (items || []).reduce((sum, item) => sum + Number(item.price) * Number(item.qty), 0);
}

function clipText(value, max) {
  return String(value || "").trim().slice(0, max);
}

function mixUnits(items) {
  const units = [];
  for (const item of items || []) {
    const qty = Math.max(1, Math.min(20, Math.floor(Number(item.qty) || 1)));
    for (let i = 0; i < qty; i += 1) units.push(item);
  }
  return units;
}

function blankSongs() {
  return ["", "", "", "", ""];
}

function songList(songs) {
  return [0, 1, 2, 3, 4].map((i) => String((songs || [])[i] || "").trim());
}

function copySheet(sheet) {
  if (!sheet || !sheet.id) return null;
  return {
    id: sheet.id,
    name: sheet.name,
    url: sheet.url,
    file: sheet.file || sheet.url,
    kind: sheet.kind || "sheets",
  };
}

function publicMix(mix) {
  return {
    id: mix.id,
    productId: mix.productId || "",
    title: mix.title || "Mix",
    price: Number(mix.price || 0),
    teamName: mix.teamName || "",
    teamLevel: mix.teamLevel || "",
    teamColors: mix.teamColors || "",
    voiceover: mix.voiceover || "",
    completionDate: mix.completionDate || "",
    songs: songList(mix.songs),
    countSheet: mix.countSheet ? { id: mix.countSheet.id, name: mix.countSheet.name } : null,
    status: PRODUCTION_STATUSES.includes(mix.status) ? mix.status : "received",
  };
}

function ensureMixes(order) {
  if (Array.isArray(order.mixes) && order.mixes.length) {
    return order.mixes.map((mix, index) => ({
      id: clipText(mix.id, 40) || `mix-${index + 1}`,
      productId: String(mix.productId || ""),
      title: String(mix.title || "Mix"),
      price: Number(mix.price || 0),
      teamName: clipText(mix.teamName, 120),
      teamLevel: clipText(mix.teamLevel, 120),
      teamColors: clipText(mix.teamColors, 120),
      voiceover: clipText(mix.voiceover, 4000),
      completionDate: clipText(mix.completionDate, 20),
      songs: songList(mix.songs),
      countSheet: copySheet(mix.countSheet),
      status: PRODUCTION_STATUSES.includes(mix.status)
        ? mix.status
        : PRODUCTION_STATUSES.includes(order.status)
          ? order.status
          : "received",
    }));
  }
  const units = mixUnits(order.items);
  const base = units.length ? units : [{ id: "", title: "Mix", price: 0 }];
  return base.map((unit, index) => ({
    id: `mix-${index + 1}`,
    productId: String(unit.id || ""),
    title: String(unit.title || unit.name || "Mix"),
    price: Number(unit.price || 0),
    teamName: index === 0 ? clipText(order.teamName, 120) : "",
    teamLevel: index === 0 ? clipText(order.teamLevel, 120) : "",
    teamColors: index === 0 ? clipText(order.teamColors, 120) : "",
    voiceover: index === 0 ? clipText(order.voiceover, 4000) : "",
    completionDate: clipText(order.completionDate, 20),
    songs: index === 0 ? songList(order.songs) : blankSongs(),
    countSheet: index === 0 ? copySheet(order.countSheet) : null,
    status: PRODUCTION_STATUSES.includes(order.status) ? order.status : "received",
  }));
}

function syncOrderFromMixes(order) {
  const mixes = ensureMixes(order);
  order.mixes = mixes;
  const first = mixes[0];
  if (!first) return order;
  order.teamName = first.teamName;
  order.teamLevel = first.teamLevel;
  order.teamColors = first.teamColors;
  order.voiceover = first.voiceover;
  order.completionDate = first.completionDate;
  order.songs = songList(first.songs);
  order.countSheet = copySheet(first.countSheet);
  return order;
}

function findMix(order, mixId) {
  const mixes = ensureMixes(order);
  order.mixes = mixes;
  const id = String(mixId || "").trim();
  if (id) return mixes.find((mix) => mix.id === id) || null;
  return mixes.length === 1 ? mixes[0] : null;
}

function buildMixes(items, body) {
  const units = mixUnits(items);
  const incoming = Array.isArray(body.mixes) ? body.mixes : [];
  if (incoming.length && incoming.length !== units.length) {
    const err = new Error("Enter team details for each mix.");
    err.status = 400;
    throw err;
  }
  const rows = incoming.length
    ? incoming
    : units.map(() => ({
        teamName: body.teamName,
        teamLevel: body.teamLevel,
        teamColors: body.teamColors,
        voiceover: body.voiceover,
        completionDate: body.completionDate,
      }));
  const mixes = units.map((unit, index) => {
    const raw = rows[index] || {};
    return {
      id: `mix-${index + 1}`,
      productId: String(unit.id || ""),
      title: String(unit.title || unit.name || "Mix"),
      price: Number(unit.price || 0),
      teamName: clipText(raw.teamName, 120),
      teamLevel: clipText(raw.teamLevel, 120),
      teamColors: clipText(raw.teamColors, 120),
      voiceover: clipText(raw.voiceover, 4000),
      completionDate: clipText(raw.completionDate, 20),
      songs: blankSongs(),
      countSheet: null,
      status: "received",
    };
  });
  const missing = mixes.find((mix) => !mix.teamName || !mix.teamColors || !mix.voiceover || !mix.completionDate);
  if (missing) {
    const err = new Error("Each mix needs a team name, colors, voiceover ideas, and a requested date.");
    err.status = 400;
    throw err;
  }
  return mixes;
}

function findOrderFile(order, fileId) {
  const id = String(fileId || "");
  if (!id) return null;
  if (order.countSheet && order.countSheet.id === id) return { file: order.countSheet, kind: order.countSheet.kind || "sheets" };
  for (const mix of order.mixes || []) {
    if (mix.countSheet && mix.countSheet.id === id) return { file: mix.countSheet, kind: mix.countSheet.kind || "sheets" };
  }
  const finished = (order.files || []).find((file) => file.id === id);
  if (finished) return { file: finished, kind: finished.kind || "mixes" };
  return null;
}

function normalizeOrder(order) {
  const production = PRODUCTION_STATUSES.includes(order.productionStatus)
    ? order.productionStatus
    : PRODUCTION_STATUSES.includes(order.status)
      ? order.status
      : "received";
  let payment = PAYMENT_STATUSES.includes(order.paymentStatus) ? order.paymentStatus : "";
  if (!payment) payment = String(order.method) === "School PO" ? "school-po" : "unpaid";
  return {
    ...order,
    status: production,
    productionStatus: production,
    paymentStatus: payment,
    notes: String(order.notes || ""),
    activity: Array.isArray(order.activity) ? order.activity : [],
    payments: Array.isArray(order.payments) ? order.payments : [],
    idempotencyKey: String(order.idempotencyKey || ""),
  };
}

function findByIdempotency(orders, key) {
  const k = String(key || "").trim().slice(0, 80);
  if (!k) return null;
  return (orders || []).find((o) => o.idempotencyKey === k) || null;
}

function buildOrder(store, body) {
  const email = String(body.email || "").toLowerCase().trim();
  const gym = String(body.gym || "").trim();
  if (!email || !gym) {
    const err = new Error("Missing order details");
    err.status = 400;
    throw err;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const err = new Error("Enter a valid email.");
    err.status = 400;
    throw err;
  }
  const method = PAY_METHODS.includes(body.method) ? body.method : "";
  if (!method) {
    const err = new Error("Choose a payment method.");
    err.status = 400;
    throw err;
  }
  const items = pricedItems(store.products, body.items);
  if (!items.length) {
    const err = new Error("Cart items are not valid.");
    err.status = 400;
    throw err;
  }
  const total = orderTotal(items);
  const paymentStatus = method === "School PO" ? "school-po" : "unpaid";
  const packageLabel = items.map((i) => `${i.title} ×${i.qty}`).join(", ");
  const mixes = buildMixes(items, body);
  const first = mixes[0] || {};
  return normalizeOrder({
    id: `ord-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
    idempotencyKey: String(body.idempotencyKey || "").trim().slice(0, 80),
    status: "received",
    productionStatus: "received",
    paymentStatus,
    method,
    total,
    items,
    packageLabel,
    gym: gym.slice(0, 120),
    coachFirst: String(body.coachFirst || "").trim().slice(0, 80),
    coachLast: String(body.coachLast || "").trim().slice(0, 80),
    email,
    completionDate: first.completionDate || "",
    teamName: first.teamName || "",
    teamLevel: first.teamLevel || "",
    teamColors: first.teamColors || "",
    voiceover: first.voiceover || "",
    mixes,
    poNumber: String(body.poNumber || "").trim().slice(0, 80),
    songs: blankSongs(),
    countSheet: null,
    createdAt: nowIso(),
    files: [],
    notes: "",
    payments: [],
    activity: [activity("created", `Order received · ${packageLabel} · $${total} · ${method} (not marked paid)`)],
  });
}

function recordPayment(order, body) {
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    const err = new Error("Enter the amount received.");
    err.status = 400;
    throw err;
  }
  const method = String(body.payMethod || body.method || order.method || "").trim().slice(0, 40);
  const reference = String(body.reference || "").trim().slice(0, 120);
  const date = String(body.date || "").trim().slice(0, 20);
  if (!method) {
    const err = new Error("Enter the payment method.");
    err.status = 400;
    throw err;
  }
  const existing = (order.payments || []).find(
    (p) => p.method === method && p.reference === reference && Number(p.amount) === amount && reference
  );
  if (existing) {
    return { order, duplicate: true, payment: existing };
  }
  const payment = {
    id: `pay-${Date.now()}`,
    amount,
    method,
    reference,
    date,
    recordedAt: nowIso(),
  };
  order.payments = order.payments || [];
  order.payments.push(payment);
  order.paymentStatus = "paid";
  order.activity = order.activity || [];
  order.activity.push(
    activity("payment", `Staff verified ${method} $${amount}${reference ? ` · ref ${reference}` : ""}${date ? ` · ${date}` : ""}`)
  );
  return { order, duplicate: false, payment };
}

function setPaymentStatus(order, status) {
  if (!PAYMENT_STATUSES.includes(status)) {
    const err = new Error("Invalid payment status");
    err.status = 400;
    throw err;
  }
  order.paymentStatus = status;
  order.activity = order.activity || [];
  order.activity.push(activity("payment-status", `Payment status set to ${status}`));
  return order;
}

function rollupProduction(mixes) {
  const rank = { received: 0, "in-progress": 1, review: 2, ready: 3 };
  const statuses = (mixes || []).map((mix) => (PRODUCTION_STATUSES.includes(mix.status) ? mix.status : "received"));
  if (!statuses.length) return "received";
  return statuses.reduce((least, current) => (rank[current] < rank[least] ? current : least));
}

function setProductionStatus(order, status, mixId) {
  if (!PRODUCTION_STATUSES.includes(status)) {
    const err = new Error("Invalid status");
    err.status = 400;
    throw err;
  }
  const mixes = ensureMixes(order);
  order.mixes = mixes;
  const id = String(mixId || "").trim();
  let mix = id ? mixes.find((item) => item.id === id) : null;
  if (id && !mix) {
    const err = new Error("Mix not found");
    err.status = 404;
    throw err;
  }
  if (!mix) {
    if (mixes.length !== 1) {
      const err = new Error("Choose one team.");
      err.status = 400;
      throw err;
    }
    mix = mixes[0];
  }
  mix.status = status;
  order.activity = order.activity || [];
  order.activity.push(activity("production", `${mix.teamName || mix.title || "Mix"} set to ${status}`));
  const rolled = rollupProduction(mixes);
  order.productionStatus = rolled;
  order.status = rolled;
  return order;
}

function saveNotes(order, notes) {
  order.notes = String(notes || "").slice(0, 4000);
  order.activity = order.activity || [];
  order.activity.push(activity("notes", "Internal notes updated"));
  return order;
}

function adminOrder(order) {
  const o = normalizeOrder(order);
  return {
    id: o.id,
    status: o.status,
    productionStatus: o.productionStatus,
    paymentStatus: o.paymentStatus,
    method: o.method,
    total: o.total,
    items: o.items || [],
    packageLabel: o.packageLabel || (o.items || []).map((i) => `${i.title} ×${i.qty}`).join(", "),
    gym: o.gym,
    coachFirst: o.coachFirst,
    coachLast: o.coachLast,
    email: o.email,
    completionDate: o.completionDate,
    teamName: o.teamName,
    teamColors: o.teamColors,
    voiceover: o.voiceover,
    mixes: ensureMixes(o).map(publicMix),
    poNumber: o.poNumber || "",
    songs: Array.isArray(o.songs) ? o.songs.map((s) => String(s || "").trim()) : [],
    countSheet: o.countSheet ? { id: o.countSheet.id, name: o.countSheet.name } : null,
    createdAt: o.createdAt,
    files: (o.files || []).map((f) => ({ id: f.id, name: f.name })),
    notes: o.notes || "",
    payments: o.payments || [],
    activity: (o.activity || []).slice().reverse(),
    brief: `${o.teamName || o.gym || "Order"} · ${(o.items || []).map((i) => i.title).join(", ") || "mix"} · due ${o.completionDate || "n/a"}`,
  };
}

module.exports = {
  PRODUCTION_STATUSES,
  PAYMENT_STATUSES,
  pricedItems,
  orderTotal,
  normalizeOrder,
  findByIdempotency,
  buildOrder,
  ensureMixes,
  publicMix,
  findMix,
  syncOrderFromMixes,
  findOrderFile,
  songList,
  recordPayment,
  setPaymentStatus,
  setProductionStatus,
  saveNotes,
  adminOrder,
  activity,
};
