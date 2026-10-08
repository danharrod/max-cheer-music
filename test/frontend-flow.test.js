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

test("shop and checkout copy match the real flow", () => {
  const shop = fs.readFileSync(path.join(__dirname, "..", "shop.html"), "utf8");
  const checkout = fs.readFileSync(path.join(__dirname, "..", "checkout.html"), "utf8");
  const home = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const cart = fs.readFileSync(path.join(__dirname, "..", "js/cart.js"), "utf8");
  const checkoutJs = fs.readFileSync(path.join(__dirname, "..", "js/checkout.js"), "utf8");
  assert.match(home, /since age 17/);
  assert.doesNotMatch(shop, /Pick a length and level/);
  assert.match(shop, /requested completion date/i);
  assert.match(shop, /songsforcheer\.com/);
  assert.match(checkout, /Place order and open PayPal/);
  assert.match(checkout, /not a confirmed deadline/i);
  assert.match(checkout, /does not mark the order paid/i);
  assert.doesNotMatch(checkoutJs, /localStorage\.setItem\("max-music-last-order"/);
  assert.match(cart, /Escape/);
  assert.match(cart, /collectSampleClips/);
});
