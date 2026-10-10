const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maxcheer-"));
process.env.MAX_TEST_STORE = "1";
process.env.MAX_SKIP_EMAILS = "1";
process.env.ADMIN_PASSWORD = "test-admin-pass";
process.env.MAX_STORE_FILE = path.join(dir, "store.json");
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.VERCEL;
delete process.env.RESEND_API_KEY;

fs.copyFileSync(path.join(__dirname, "..", "data", "store.json"), process.env.MAX_STORE_FILE);

const portal = require("../api/portal");
const orderApi = require("../api/order");
const { getStore, hashPassword } = require("../lib/store");
const { upsertUser } = require("../api/portal");

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    headersSent: false,
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      this.headersSent = true;
      return this;
    },
    end(data) {
      if (data !== undefined) this.body = data;
      this.headersSent = true;
    },
  };
}

function mockReq(body) {
  return {
    method: "POST",
    body,
    headers: { host: "localhost", origin: "http://127.0.0.1:5173" },
  };
}

async function call(handler, body) {
  const res = mockRes();
  await handler(mockReq(body), res);
  return res;
}

test("returning checkout does not overwrite portal password", async () => {
  const store = await getStore();
  upsertUser(store, {
    email: "coach@example.com",
    password: "first-password",
    gym: "Test Gym",
    coachFirst: "A",
    coachLast: "B",
  });
  const firstHash = store.users.find((u) => u.email === "coach@example.com").passwordHash;
  upsertUser(store, {
    email: "coach@example.com",
    password: "second-password",
    gym: "Test Gym 2",
  });
  const user = store.users.find((u) => u.email === "coach@example.com");
  assert.equal(user.passwordHash, firstHash);
  assert.equal(user.gym, "Test Gym 2");
  assert.notEqual(hashPassword("second-password", user.salt), user.passwordHash);
});

test("password reset works without revealing missing emails", async () => {
  const missing = await call(portal, { action: "request-reset", email: "nobody@example.com" });
  assert.equal(missing.statusCode, 200);
  assert.match(missing.body.message, /reset link/i);
  assert.equal(missing.body.testResetToken, undefined);

  const store = await getStore();
  upsertUser(store, { email: "reset@example.com", password: "old-pass-1", gym: "Gym" });
  const { saveStore } = require("../lib/store");
  await saveStore(store);

  const asked = await call(portal, { action: "request-reset", email: "reset@example.com" });
  assert.equal(asked.statusCode, 200);
  assert.equal(asked.body.message, missing.body.message);
  assert.ok(asked.body.testResetToken);

  const bad = await call(portal, { action: "reset-password", resetToken: "nope", password: "new-pass-1" });
  assert.equal(bad.statusCode, 400);

  const ok = await call(portal, {
    action: "reset-password",
    resetToken: asked.body.testResetToken,
    password: "new-pass-1",
  });
  assert.equal(ok.statusCode, 200);

  const loginOld = await call(portal, { action: "login", email: "reset@example.com", password: "old-pass-1" });
  assert.equal(loginOld.statusCode, 401);
  const loginNew = await call(portal, { action: "login", email: "reset@example.com", password: "new-pass-1" });
  assert.equal(loginNew.statusCode, 200);
  assert.equal(loginNew.body.user.email, "reset@example.com");
});

test("orders use catalog prices, block duplicates, and stay unpaid", async () => {
  const payload = {
    method: "paypal",
    idempotencyKey: "test-key-1",
    email: "order@example.com",
    password: "portal1",
    gym: "North Gym",
    coachFirst: "Pat",
    coachLast: "Lee",
    teamName: "Elite",
    teamColors: "Blue",
    voiceover: "Hit hard",
    completionDate: "2026-11-01",
    items: [{ id: "allstar", qty: 1, price: 1, title: "tampered" }],
    total: 1,
  };
  const first = await call(orderApi, payload);
  assert.equal(first.statusCode, 200);
  assert.ok(first.body.orderId);
  assert.equal(first.body.emailed, false);

  const store = await getStore();
  const saved = store.orders.find((o) => o.id === first.body.orderId);
  assert.equal(saved.total, 1100);
  assert.equal(saved.items[0].price, 1100);
  assert.equal(saved.items[0].title, "Allstar Mix");
  assert.equal(saved.paymentStatus, "unpaid");
  assert.notEqual(saved.paymentStatus, "paid");

  const dup = await call(orderApi, payload);
  assert.equal(dup.statusCode, 200);
  assert.equal(dup.body.orderId, first.body.orderId);
  assert.equal(dup.body.duplicate, true);
  const after = await getStore();
  assert.equal(after.orders.filter((o) => o.email === "order@example.com").length, 1);
});

test("admin mix attach by url shows on the customer order", async () => {
  const adminApi = require("../api/admin");
  const login = await call(adminApi, { action: "login", password: "test-admin-pass", token: "" });
  assert.equal(login.statusCode, 200);
  const placed = await call(orderApi, {
    method: "paypal",
    idempotencyKey: "mix-key-1",
    email: "mix@example.com",
    password: "portal1",
    gym: "Mix Gym",
    coachFirst: "Pat",
    coachLast: "Lee",
    teamName: "Mix Team",
    teamColors: "Blue",
    voiceover: "Hits",
    completionDate: "2026-11-01",
    items: [{ id: "allstar", qty: 1 }],
  });
  assert.equal(placed.statusCode, 200);
  const attached = await call(adminApi, {
    action: "attach",
    token: login.body.token,
    orderId: placed.body.orderId,
    filename: "elite-mix.mp3",
    url: "https://example.com/elite-mix.mp3",
  });
  assert.equal(attached.statusCode, 200);
  const listed = (attached.body.orders || []).find((o) => o.id === placed.body.orderId);
  assert.ok(listed.files.some((f) => f.name === "elite-mix.mp3"));
  const { publicOrder } = require("../lib/store");
  const saved = (await getStore()).orders.find((o) => o.id === placed.body.orderId);
  const pub = publicOrder(saved);
  assert.equal(pub.files[0].name, "elite-mix.mp3");
  assert.equal(pub.status, "ready");
});

test("shop and checkout copy match the real flow", () => {
  const shop = fs.readFileSync(path.join(__dirname, "..", "shop.html"), "utf8");
  const checkout = fs.readFileSync(path.join(__dirname, "..", "checkout.html"), "utf8");
  const home = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const cart = fs.readFileSync(path.join(__dirname, "..", "js/cart.js"), "utf8");
  const checkoutJs = fs.readFileSync(path.join(__dirname, "..", "js/checkout.js"), "utf8");
  assert.match(home, /since age 17/);
  assert.doesNotMatch(shop, /Pick a length and level/);
  assert.doesNotMatch(shop, /How ordering works/);
  assert.match(checkout, /songsforcheer\.com/);
  assert.match(checkout, /Place order and open PayPal/);
  assert.match(checkout, /not a confirmed deadline/i);
  assert.match(checkout, /does not mark the order paid/i);
  assert.match(checkout, /data-step="contact"/);
  assert.match(checkout, /data-step="payment"/);
  assert.match(checkout, /class="btn step-next"/);
  assert.match(checkoutJs, /initCheckoutSteps/);
  assert.doesNotMatch(checkoutJs, /localStorage\.setItem\("max-music-last-order"/);
  assert.match(cart, /Escape/);
  assert.match(cart, /collectSampleClips/);
  assert.match(cart, /youtube-nocookie\.com\/embed/);
  const adminJs = fs.readFileSync(path.join(__dirname, "..", "js/admin.js"), "utf8");
  assert.match(adminJs, /clip-youtube/);
  assert.match(adminJs, /data-payment/);
  assert.match(adminJs, /label: "Ordered"/);
  assert.match(adminJs, /label: "In production"/);
  assert.match(adminJs, /label: "Ready for review"/);
  assert.match(adminJs, /label: "Completed"/);
  assert.match(adminJs, /data-order-tab=/);
  const portalJs = fs.readFileSync(path.join(__dirname, "..", "js/portal.js"), "utf8");
  assert.match(portalJs, /Ordered/);
  assert.match(portalJs, /In production/);
  assert.match(portalJs, /Ready for review/);
  assert.match(portalJs, /Completed/);
  assert.match(portalJs, /Not paid/);
  assert.doesNotMatch(portalJs, /Mix in progress/);
  assert.match(adminJs, /Requested completion date/);
  assert.match(adminJs, /Voiceover ideas/);
  assert.match(portalJs, /Requested date/);
  assert.match(portalJs, /Voiceover ideas/);
  assert.match(portalJs, /PO number/);
});

test("customer portal receives paid or not paid", () => {
  const { publicOrder } = require("../lib/store");
  assert.equal(publicOrder({ id: "1", status: "received", paymentStatus: "paid" }).paymentStatus, "paid");
  assert.equal(publicOrder({ id: "2", status: "in-progress", paymentStatus: "unpaid" }).paymentStatus, "unpaid");
  assert.equal(publicOrder({ id: "3", status: "ready", paymentStatus: "school-po" }).paymentStatus, "unpaid");
});

test("YouTube sample URLs parse into catalog clips", () => {
  const { youtubeIdFromUrl, inferSampleKind, publicCatalog } = require("../lib/store");
  assert.equal(youtubeIdFromUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(youtubeIdFromUrl("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(youtubeIdFromUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(inferSampleKind("https://youtu.be/dQw4w9WgXcQ", ""), "youtube");
  const catalog = publicCatalog({
    settings: {},
    products: [],
    clips: [{ id: "yt-1", name: "Warhawks", url: "https://youtu.be/dQw4w9WgXcQ", kind: "youtube", published: true, sort: 0 }],
  });
  assert.equal(catalog.clips[0].kind, "youtube");
  assert.equal(catalog.clips[0].youtubeId, "dQw4w9WgXcQ");
  assert.equal(catalog.clips[0].url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
});

test("existing production statuses stay valid and review is available", () => {
  const { setProductionStatus, normalizeOrder, PRODUCTION_STATUSES } = require("../lib/orders");
  assert.deepEqual(PRODUCTION_STATUSES, ["received", "in-progress", "review", "ready"]);
  const finished = normalizeOrder({ id: "old", status: "ready", paymentStatus: "paid" });
  assert.equal(finished.status, "ready");
  assert.equal(finished.productionStatus, "ready");
  const review = setProductionStatus(normalizeOrder({ id: "new", status: "received" }), "review");
  assert.equal(review.status, "review");
  assert.equal(review.productionStatus, "review");
  assert.throws(() => setProductionStatus(review, "done"), /Invalid status/);
});
