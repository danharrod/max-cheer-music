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
    completionDate: String(body.completionDate || "").trim().slice(0, 20),
    teamName: String(body.teamName || "").trim().slice(0, 120),
    teamColors: String(body.teamColors || "").trim().slice(0, 120),
    voiceover: String(body.voiceover || "").trim().slice(0, 4000),
    poNumber: String(body.poNumber || "").trim().slice(0, 80),
    songs: [],
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

function setProductionStatus(order, status) {
  if (!PRODUCTION_STATUSES.includes(status)) {
    const err = new Error("Invalid status");
    err.status = 400;
    throw err;
  }
  order.productionStatus = status;
  order.status = status;
  order.activity = order.activity || [];
  order.activity.push(activity("production", `Production status set to ${status}`));
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
  recordPayment,
  setPaymentStatus,
  setProductionStatus,
  saveNotes,
  adminOrder,
  activity,
};
