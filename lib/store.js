const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const FILE = process.env.VERCEL
  ? path.join("/tmp", "max-store.json")
  : path.join(process.cwd(), "data", "store.json");
const SEED = path.join(process.cwd(), "data", "store.json");
const SAMPLE_DIR = process.env.VERCEL
  ? path.join("/tmp", "samples")
  : path.join(process.cwd(), "assets", "samples");
const MIX_DIR = process.env.VERCEL
  ? path.join("/tmp", "mixes")
  : path.join(process.cwd(), "assets", "mixes");
const SHEET_DIR = process.env.VERCEL
  ? path.join("/tmp", "sheets")
  : path.join(process.cwd(), "assets", "sheets");

function dirFor(kind) {
  if (kind === "mixes") return MIX_DIR;
  if (kind === "sheets") return SHEET_DIR;
  return SAMPLE_DIR;
}

function seed() {
  try {
    const data = JSON.parse(fs.readFileSync(SEED, "utf8"));
    data.users = data.users || [];
    data.orders = data.orders || [];
    return data;
  } catch {
    return {
      settings: { paypalMe: "danharrod12", venmo: "daniel-harrod-3", email: "maxcheermusic@gmail.com" },
      products: [],
      users: [],
      orders: [],
    };
  }
}

function secret() {
  return process.env.ADMIN_PASSWORD || "maxmusic-secret";
}

async function readBlobStore() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  const { list } = require("@vercel/blob");
  const { blobs } = await list({ prefix: "max-store.json", limit: 10, token });
  const blob = (blobs || []).find((b) => b.pathname === "max-store.json" || b.pathname.endsWith("/max-store.json"));
  if (!blob) return null;
  const file = await fetch(blob.url);
  if (!file.ok) return null;
  return file.json();
}

async function writeBlobStore(store) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return false;
  const { put } = require("@vercel/blob");
  await put("max-store.json", JSON.stringify(store), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    token,
  });
  return true;
}

function readFileStore() {
  try {
    if (fs.existsSync(FILE)) {
      const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
      data.users = data.users || [];
      data.orders = data.orders || [];
      return data;
    }
  } catch {}
  return seed();
}

function writeFileStore(store) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(store, null, 2));
}

async function getStore() {
  const fromBlob = await readBlobStore().catch(() => null);
  if (fromBlob) {
    fromBlob.users = fromBlob.users || [];
    fromBlob.orders = fromBlob.orders || [];
    return fromBlob;
  }
  return readFileStore();
}

async function saveStore(store) {
  const blobOk = await writeBlobStore(store).catch((err) => {
    console.error("blob save failed", err);
    return false;
  });
  if (!process.env.VERCEL) writeFileStore(store);
  else if (!blobOk) writeFileStore(store);
  return blobOk || !process.env.VERCEL;
}

function publicCatalog(store) {
  return {
    settings: {
      paypalMe: store.settings?.paypalMe || "",
      venmo: store.settings?.venmo || "",
      email: store.settings?.email || "maxcheermusic@gmail.com",
    },
    products: (store.products || []).filter((p) => p.active !== false),
  };
}

function adminPassword() {
  return process.env.ADMIN_PASSWORD || (process.env.VERCEL ? "" : "maxmusic");
}

function makeToken() {
  const password = adminPassword();
  if (!password) return "";
  return crypto.createHmac("sha256", password).update("max-cheer-music-admin").digest("hex");
}

function validToken(token) {
  const expected = makeToken();
  if (!expected || !token) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(String(token)), Buffer.from(expected));
  } catch {
    return false;
  }
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString("hex");
}

function customerToken(email, passwordHash) {
  return crypto.createHmac("sha256", secret()).update(`${email.toLowerCase()}:${passwordHash}`).digest("hex");
}

function validCustomer(store, email, token) {
  const user = (store.users || []).find((u) => u.email === String(email || "").toLowerCase());
  if (!user || !token) return null;
  const expected = customerToken(user.email, user.passwordHash);
  try {
    if (crypto.timingSafeEqual(Buffer.from(String(token)), Buffer.from(expected))) return user;
  } catch {}
  return null;
}

function publicUser(user) {
  return {
    email: user.email,
    coachFirst: user.coachFirst || "",
    coachLast: user.coachLast || "",
    gym: user.gym || "",
  };
}

function publicOrder(order) {
  return {
    id: order.id,
    status: order.status || "received",
    method: order.method,
    total: order.total,
    items: order.items || [],
    gym: order.gym,
    coachFirst: order.coachFirst,
    coachLast: order.coachLast,
    email: order.email,
    completionDate: order.completionDate,
    teamName: order.teamName,
    teamColors: order.teamColors,
    voiceover: order.voiceover,
    poNumber: order.poNumber || "",
    songs: Array.isArray(order.songs) ? order.songs.map((s) => String(s || "").trim()) : [],
    countSheet: order.countSheet
      ? { id: order.countSheet.id, name: order.countSheet.name }
      : null,
    createdAt: order.createdAt,
    files: (order.files || []).map((f) => ({ id: f.id, name: f.name })),
  };
}

async function saveUpload(filename, buffer, kind = "samples") {
  const safe = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token) {
    const { put } = require("@vercel/blob");
    const blob = await put(`${kind}/${safe}`, buffer, {
      access: "public",
      addRandomSuffix: false,
      token,
    });
    return { url: blob.url, path: blob.url, name: filename };
  }
  if (process.env.VERCEL) throw new Error("Upload failed");
  const dir = dirFor(kind);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, safe);
  fs.writeFileSync(dest, buffer);
  return { url: `/assets/${kind}/${safe}`, path: dest, name: filename, file: safe };
}

function readLocalFile(kind, file) {
  const dir = dirFor(kind);
  const full = path.join(dir, path.basename(file));
  if (!full.startsWith(dir) || !fs.existsSync(full)) return null;
  return fs.readFileSync(full);
}

module.exports = {
  getStore,
  saveStore,
  publicCatalog,
  adminPassword,
  makeToken,
  validToken,
  saveUpload,
  hashPassword,
  customerToken,
  validCustomer,
  publicUser,
  publicOrder,
  readLocalFile,
  MIX_DIR,
  SAMPLE_DIR,
  SHEET_DIR,
};
